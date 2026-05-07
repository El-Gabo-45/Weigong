/**
 * nn-bridge.js - Puente Node.js ↔ Red Neuronal GPU (OpenCL/RX 570)
 *
 * Permite:
 *   1. Entrenar la red con datos de partidas (selfplay)
 *   2. Evaluar posiciones con la red entrenada
 *   3. Integrar en server.js y bot.js
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NN_DIR = path.join(__dirname, '..', 'neural_network_gpu');
const TRAIN_BIN = path.join(NN_DIR, 'nn_train');
const KERNEL_FILE = path.join(NN_DIR, 'nn_kernel.cl');
const DEFAULT_MODEL = path.join(NN_DIR, 'model.bin');

// Estado interno
let isTraining = false;

/**
 * Asegura que los binarios y kernels existan
 */
async function ensureBinaries() {
    // Si no existe, compilar
    try {
        await fs.promises.access(TRAIN_BIN);
    } catch {
        console.log('⚙️  Compilando nn_train...');
        const { execSync } = await import('node:child_process');
        execSync('make nn_train nn_gpu', { cwd: NN_DIR, stdio: 'inherit' });
    }
    // Asegurar kernel en cwd
    try {
        await fs.promises.access(path.join(NN_DIR, 'nn_kernel.cl'));
    } catch {
        await fs.promises.copyFile(KERNEL_FILE, path.join(NN_DIR, 'nn_kernel.cl'));
    }
}

/**
 * Entrena la red neuronal con los datos de partidas guardadas
 * 
 * @param {Object} options
 * @param {string} options.modelPath - Ruta al modelo (default: neural_network_gpu/model.bin)
 * @param {number} options.epochs - Épocas de entrenamiento (default: 10)
 * @param {number} options.batchSize - Tamaño de batch (default: 64)
 * @param {Array<Object>} options.games - Array de partidas con movimientos
 * @returns {Promise<Object>} Métricas de entrenamiento
 */
export async function trainFromGames(options = {}) {
    if (isTraining) throw new Error('Ya hay un entrenamiento en curso');
    isTraining = true;

    const {
        modelPath = DEFAULT_MODEL,
        epochs = 10,
        batchSize = 64,
        games = [],
    } = options;

    try {
        await ensureBinaries();

        // Extraer datos de entrenamiento de las partidas
        const inputs = [];    // Float32Array[4056]
        const scores = [];    // score de evaluación

        for (const game of games) {
            if (!game.moves || !Array.isArray(game.moves)) continue;

            // Determinar resultado para dar señal a los movimientos
            let resultSign = 0; // 0 = draw, 1 = win for black, -1 = loss
            if (game.finalStatus === 'checkmate' || game.finalStatus === 'palacemate') {
                const lastMove = game.moves[game.moves.length - 1];
                resultSign = lastMove?.side === 'black' ? 1 : -1;
            }

            for (const move of game.moves) {
                if (!move._nnFloat32) continue;

                // Normalizar score: cuanto más cerca del final, más importancia
                const evalScore = move.evalAfter ?? 0;
                const normalized = Math.tanh(evalScore / 1000); // [-1, 1]

                // Agregar sesgo según resultado final
                const biased = normalized + resultSign * 0.1;
                const clamped = Math.max(-1, Math.min(1, biased));

                inputs.push(Array.from(move._nnFloat32));
                scores.push(clamped);
            }
        }

        if (inputs.length === 0) {
            return { trained: false, samples: 0, message: 'No hay datos con _nnFloat32' };
        }

        // Construir JSON para stdin del binario
        const jsonData = JSON.stringify({ inputs, scores });
        
        // Invocar binario C++
        console.log(`🧠 Entrenando red GPU con ${inputs.length} muestras (${epochs} epochs, batch ${batchSize})...`);
        
        const result = await runTrainBinary(modelPath, epochs, batchSize, jsonData);
        
        console.log(`✅ Entrenamiento completo: ${result.final_mse?.toFixed(6) ?? '?'} MSE`);
        
        return {
            trained: true,
            samples: inputs.length,
            ...result,
        };
    } finally {
        isTraining = false;
    }
}

/**
 * Ejecuta el binario nn_train con los datos
 */
function runTrainBinary(modelPath, epochs, batchSize, jsonData) {
    return new Promise((resolve, reject) => {
        const proc = spawn(TRAIN_BIN, [modelPath, String(epochs), String(batchSize)], {
            cwd: NN_DIR,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('nn_train stderr:', stderr);
                reject(new Error(`nn_train exit code ${code}: ${stderr}`));
                return;
            }
            try {
                // Parsear JSON de stdout
                const result = JSON.parse(stdout);
                resolve(result);
            } catch {
                resolve({ raw_stdout: stdout, stderr });
            }
        });

        proc.on('error', reject);

        // Enviar datos por stdin
        proc.stdin.write(jsonData);
        proc.stdin.end();
    });
}

/**
 * Carga el modelo y prepara para evaluación
 * (llama al binario nn_gpu --predict para evaluar posiciones)
 * 
 * @param {Float32Array} nnEncoding - Codificación 4056 floats del tablero
 * @param {string} modelPath - Ruta al modelo
 * @returns {Promise<number>} Score predicho [-1, 1]
 */
export async function predictScore(nnEncoding, modelPath = DEFAULT_MODEL) {
    // Convertir Float32Array a array normal para JSON
    const input = Array.from(nnEncoding);
    
    return new Promise((resolve, reject) => {
        // Usamos nn_gpu con modo predict
        const proc = spawn(path.join(NN_DIR, 'nn_gpu'), ['--predict', modelPath], {
            cwd: NN_DIR,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { 
            if (data.length < 200) stderr += data.toString(); 
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                resolve(null); // Si falla, devolvemos null
                return;
            }
            try {
                const result = JSON.parse(stdout);
                resolve(result.score ?? null);
            } catch {
                resolve(null);
            }
        });

        proc.on('error', () => resolve(null));

        // Enviar input
        const jsonData = JSON.stringify({ input });
        proc.stdin.write(jsonData);
        proc.stdin.end();
    });
}

/**
 * Obtiene estadísticas del modelo entrenado
 */
export async function getModelInfo(modelPath = DEFAULT_MODEL) {
    try {
        const stat = await fs.promises.stat(modelPath);
        return {
            exists: true,
            sizeBytes: stat.size,
            lastModified: stat.mtime,
        };
    } catch {
        return { exists: false };
    }
}

export default {
    trainFromGames,
    predictScore,
    getModelInfo,
};