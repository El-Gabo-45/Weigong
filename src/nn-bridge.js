/**
 * nn-bridge.js - Puente Node.js ↔ Red Neuronal GPU (OpenCL/RX 570)
 *
 * El binario nn_train espera stdin JSON: { "inputs": [[...]], "scores": [...] }
 * El binario nn_gpu  espera stdin JSON: { "input": [...] }
 * Arquitectura fija en C++: input_dim → 512 → 256 → 128 → 64 → 1 (Huber, AdamW)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const NN_DIR      = path.join(__dirname, '..', 'neural_network_gpu');
const TRAIN_BIN   = path.join(NN_DIR, 'nn_train');
const KERNEL_FILE = path.join(NN_DIR, 'nn_kernel.cl');
const DEFAULT_MODEL = path.join(NN_DIR, 'model.bin');

let isTraining = false;

async function ensureBinaries() {
  try {
    await fs.promises.access(TRAIN_BIN);
  } catch {
    console.log('⚙️  Compilando nn_train...');
    const { execSync } = await import('node:child_process');
    execSync('make nn_train nn_gpu', { cwd: NN_DIR, stdio: 'inherit' });
  }
  try {
    await fs.promises.access(path.join(NN_DIR, 'nn_kernel.cl'));
  } catch {
    await fs.promises.copyFile(KERNEL_FILE, path.join(NN_DIR, 'nn_kernel.cl'));
  }
}

// ── Diagnóstico previo al entrenamiento ───────────────────────────────────────
export function diagnoseGames(games) {
  let totalMoves = 0, withNN = 0, decisive = 0, drawLimit = 0, otherDraw = 0;
  const statusCounts = {};

  for (const game of games) {
    if (!game.moves?.length) continue;
    const s = game.finalStatus ?? 'unknown';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    if (s === 'checkmate' || s === 'palacemate') decisive++;
    else if (s === 'draw_move_limit')             drawLimit++;
    else                                           otherDraw++;
    for (const m of game.moves) {
      totalMoves++;
      if (m._nnFloat32) withNN++;
    }
  }

  return {
    games: games.length, decisive, drawLimit, otherDraw,
    decisiveRate: games.length > 0 ? ((decisive / games.length) * 100).toFixed(1) + '%' : '0%',
    totalMoves, withNN,
    nnCoverage: totalMoves > 0 ? ((withNN / totalMoves) * 100).toFixed(1) + '%' : '0%',
    statusCounts,
  };
}

// ── Construcción de targets ───────────────────────────────────────────────────
//
// El C++ usa Huber loss y salida tanh → targets deben estar en [-1, 1].
//
// Problema original: Math.tanh(score/1000) con scores típicos ±300-600
// da targets en ±0.29–0.54. Con 70% empates, la red aprende a predecir ~0.
//
// Solución:
//   1. Escala más agresiva: tanh(score/300) → ±300 ya da ±0.70, ±600 da ±0.92
//   2. Partidas decisivas: mezcla heurística + señal del resultado,
//      con el resultado ganando peso hacia el final de la partida.
//   3. Empates por límite: solo heurística muy suavizada (×0.25).
//      Los movimientos del último 50% se descartan directamente.
//   4. Empates reales: heurística suavizada (×0.5), sin señal de resultado.

function buildTargets(game) {
  const finalStatus = game.finalStatus ?? 'unknown';
  const isDecisive  = finalStatus === 'checkmate' || finalStatus === 'palacemate';
  const isDrawLimit = finalStatus === 'draw_move_limit';
  const moves       = game.moves;
  const total       = moves.length;

  // Señal del resultado: +1 negro ganó, -1 blanco ganó, 0 empate
  let resultSign = 0;
  if (isDecisive) {
    const last = moves[total - 1];
    resultSign = last?.side === 'black' ? 1 : -1;
  }

  const inputs  = [];
  const scores  = [];

  for (let i = 0; i < total; i++) {
    const move = moves[i];
    if (!move._nnFloat32) continue;

    const progress  = i / Math.max(total - 1, 1); // 0.0 → 1.0
    const evalScore = move.evalAfter ?? 0;

    // Normalización más agresiva: tanh(x/300) en vez de tanh(x/1000)
    const heuristic = Math.tanh(evalScore / 300);

    let target;

    if (isDecisive) {
      // Resultado gana peso progresivamente:
      // primer movimiento → 10% resultado, 90% heurística
      // último movimiento → 80% resultado, 20% heurística
      const resultWeight = 0.1 + 0.7 * progress;
      target = (1 - resultWeight) * heuristic + resultWeight * resultSign;

    } else if (isDrawLimit) {
      // Empate por límite: descartar la segunda mitad (ruido puro)
      if (progress > 0.5) continue;
      // Primera mitad: heurística muy suavizada
      target = heuristic * 0.25;

    } else {
      // Empate real (repetición, stalemate): heurística suavizada
      target = heuristic * 0.5;
    }

    inputs.push(Array.from(move._nnFloat32));
    scores.push(Math.max(-1, Math.min(1, target)));
  }

  return { inputs, scores };
}

// ── Entrenamiento ─────────────────────────────────────────────────────────────
export async function trainFromGames(options = {}) {
  if (isTraining) throw new Error('Training already in progress');
  isTraining = true;

  const {
    modelPath = DEFAULT_MODEL,
    epochs    = 10,
    batchSize = 64,
    games     = [],
  } = options;

  try {
    await ensureBinaries();

    // Diagnóstico
    const diag = diagnoseGames(games);
    console.log(`📊 Dataset: ${diag.games} games | decisive: ${diag.decisive} (${diag.decisiveRate}) | draw_limit: ${diag.drawLimit} | other: ${diag.otherDraw}`);
    console.log(`   Moves: ${diag.totalMoves} total | with NN data: ${diag.withNN} (${diag.nnCoverage})`);

    if (diag.withNN === 0) {
      console.warn('⚠️  No moves have _nnFloat32 — games saved before NN encoding was added.');
      console.warn('   Generate new games with POST /api/selfPlay');
      return { trained: false, samples: 0, message: 'No _nnFloat32 data. Generate new selfplay games first.', diagnosis: diag };
    }

    // Construir dataset
    const allInputs = [];
    const allScores = [];

    for (const game of games) {
      if (!game.moves?.length) continue;
      const { inputs, scores } = buildTargets(game);
      for (let i = 0; i < inputs.length; i++) {
        allInputs.push(inputs[i]);
        allScores.push(scores[i]);
      }
    }

    if (allInputs.length === 0) {
      return { trained: false, samples: 0, message: 'All samples filtered out', diagnosis: diag };
    }

    // Log distribución de targets
    const buckets = Array(10).fill(0);
    for (const s of allScores) {
      buckets[Math.min(9, Math.floor((s + 1) / 2 * 10))]++;
    }
    const labels = ['-1.0','-0.8','-0.6','-0.4','-0.2',' 0.0',' 0.2',' 0.4',' 0.6',' 0.8'];
    console.log(`📈 Target distribution (${allInputs.length} samples):`);
    for (let i = 0; i < 10; i++) {
      const bar = '█'.repeat(Math.round((buckets[i] / allInputs.length) * 36));
      console.log(`   ${labels[i]}: ${bar} ${buckets[i]}`);
    }

    // El binario solo acepta "inputs" y "scores" — no "weights"
    const jsonData = JSON.stringify({ inputs: allInputs, scores: allScores });

    console.log(`🧠 Training GPU: ${allInputs.length} samples, ${epochs} epochs, batch ${batchSize}...`);
    const result = await runTrainBinary(modelPath, epochs, batchSize, jsonData);
    console.log(`✅ Done — MSE: ${result.final_mse?.toFixed(6) ?? '?'}`);

    return { trained: true, samples: allInputs.length, ...result, diagnosis: diag };

  } finally {
    isTraining = false;
  }
}

// ── Ejecutar binario con escritura en chunks ──────────────────────────────────
function runTrainBinary(modelPath, epochs, batchSize, jsonData) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TRAIN_BIN, [modelPath, String(epochs), String(batchSize)], {
      cwd: NN_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      stderr += d.toString();
      // Pasar stderr del C++ a la consola de Node en tiempo real
      process.stderr.write(d);
    });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`nn_train exit ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      try   { resolve(JSON.parse(stdout)); }
      catch { resolve({ raw_stdout: stdout }); }
    });

    proc.on('error', reject);

    // Escribir en chunks para evitar bloqueo con datasets grandes
    const CHUNK = 64 * 1024;
    let offset = 0;
    function writeChunk() {
      if (offset >= jsonData.length) { proc.stdin.end(); return; }
      const chunk = jsonData.slice(offset, offset + CHUNK);
      offset += CHUNK;
      if (!proc.stdin.write(chunk)) proc.stdin.once('drain', writeChunk);
      else setImmediate(writeChunk);
    }
    writeChunk();
  });
}

// ── Predicción ────────────────────────────────────────────────────────────────
export async function predictScore(nnEncoding, modelPath = DEFAULT_MODEL) {
  return new Promise(resolve => {
    const proc = spawn(path.join(NN_DIR, 'nn_gpu'), ['--predict', modelPath], {
      cwd: NN_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { if (stderr.length < 300) stderr += d.toString(); });

    proc.on('close', code => {
      if (code !== 0) { resolve(null); return; }
      try   { resolve(JSON.parse(stdout).score ?? null); }
      catch { resolve(null); }
    });

    proc.on('error', () => resolve(null));

    proc.stdin.write(JSON.stringify({ input: Array.from(nnEncoding) }));
    proc.stdin.end();
  });
}

// ── Info del modelo ───────────────────────────────────────────────────────────
export async function getModelInfo(modelPath = DEFAULT_MODEL) {
  try {
    const stat = await fs.promises.stat(modelPath);
    return {
      exists:       true,
      sizeBytes:    stat.size,
      sizeKB:       (stat.size / 1024).toFixed(1) + ' KB',
      lastModified: stat.mtime,
      path:         modelPath,
    };
  } catch {
    return { exists: false, path: modelPath };
  }
}

export default { trainFromGames, predictScore, getModelInfo, diagnoseGames };