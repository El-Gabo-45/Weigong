/**
 * nn-bridge.js - Puente Node.js ↔ Red Neuronal GPU (OpenCL/RX 570)
 *
 * Protocolo de datos: archivo binario temporal en vez de JSON.
 * Formato: [int32 n_samples][int32 input_dim][float32 * n*dim][float32 * n]
 * Esto elimina el cuello de botella de serialización JSON (~15x más rápido).
 */

import { spawn }        from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path              from 'node:path';
import fs                from 'node:fs';
import os                from 'node:os';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const NN_DIR        = path.join(__dirname, '..', '..', 'neural_network_gpu');
const TRAIN_BIN     = path.join(NN_DIR, 'nn_train');
const KERNEL_FILE   = path.join(NN_DIR, 'nn_kernel.cl');
const DEFAULT_MODEL = path.join(NN_DIR, 'model.bin');

// Variables de entorno para que Rusticl exponga la RX 570 como GPU OpenCL
const GPU_ENV = { ...process.env, RUSTICL_ENABLE: 'radeonsi' };

let isTraining = false;

async function ensureBinaries() {
  let compileNeeded = false;

  try {
    await fs.promises.access(TRAIN_BIN);
    await fs.promises.access(path.join(NN_DIR, 'nn_gpu'));
  } catch {
    compileNeeded = true;
  }

  if (!compileNeeded) {
    try {
      const binStat = await fs.promises.stat(TRAIN_BIN);
      const srcFiles = await fs.promises.readdir(path.join(NN_DIR, 'src'));
      for (const fileName of srcFiles) {
        if (!fileName.endsWith('.cpp') && !fileName.endsWith('.h')) continue;
        const fileStat = await fs.promises.stat(path.join(NN_DIR, 'src', fileName));
        if (fileStat.mtimeMs > binStat.mtimeMs) {
          compileNeeded = true;
          break;
        }
      }
    } catch {
      compileNeeded = true;
    }
  }

  if (compileNeeded) {
    console.log('⚙️  Compiling nn_train and nn_gpu...');
    const { execSync } = await import('node:child_process');
    execSync('make nn_train nn_gpu', { cwd: NN_DIR, stdio: 'inherit' });
  }

  try {
    await fs.promises.access(KERNEL_FILE);
  } catch {
    throw new Error(`Missing OpenCL kernel file: ${KERNEL_FILE}`);
  }
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────
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
function buildTargets(game) {
  const finalStatus = game.finalStatus ?? 'unknown';
  const isDecisive  = finalStatus === 'checkmate' || finalStatus === 'palacemate';
  const isDrawLimit = finalStatus === 'draw_move_limit';
  const moves       = game.moves;
  const total       = moves.length;

  let resultSign = 0;
  if (isDecisive) {
    const last = moves[total - 1];
    resultSign = last?.side === 'black' ? 1 : -1;
  }

  const inputs = [];
  const scores = [];

  for (let i = 0; i < total; i++) {
    const move = moves[i];
    if (!move._nnFloat32) continue;

    const progress  = i / Math.max(total - 1, 1);
    const evalScore = move.evalAfter ?? 0;
    const heuristic = Math.tanh(evalScore / 300);

    let target;

    if (isDecisive) {
      const resultWeight = 0.1 + 0.7 * progress;
      target = (1 - resultWeight) * heuristic + resultWeight * resultSign;
    } else if (isDrawLimit) {
      if (progress > 0.5) continue;
      target = heuristic * 0.25;
    } else {
      target = heuristic * 0.5;
    }

    inputs.push(Array.isArray(move._nnFloat32) ? move._nnFloat32 : Array.from(move._nnFloat32));
    scores.push(Math.max(-1, Math.min(1, target)));
  }

  return { inputs, scores };
}

// ── Escribe dataset como binario puro ─────────────────────────────────────────
// Formato: [int32 n_samples][int32 input_dim][float32 * n*dim][float32 * n]
// Sin JSON, sin texto — Node.js solo hace memcpy de floats.
function writeDatasetBin(filePath, allInputs, allScores) {
  const n        = allInputs.length;
  const inputDim = allInputs[0].length;

  const header = Buffer.allocUnsafe(8);
  header.writeInt32LE(n,        0);
  header.writeInt32LE(inputDim, 4);

  const xBuf = Buffer.allocUnsafe(n * inputDim * 4);
  for (let i = 0; i < n; i++) {
    const row = allInputs[i];
    for (let j = 0; j < inputDim; j++) {
      xBuf.writeFloatLE(row[j], (i * inputDim + j) * 4);
    }
  }

  const yBuf = Buffer.allocUnsafe(n * 4);
  for (let i = 0; i < n; i++) {
    yBuf.writeFloatLE(allScores[i], i * 4);
  }

  fs.writeFileSync(filePath, Buffer.concat([header, xBuf, yBuf]));
}

// ── Training ──────────────────────────────────────────────────────────────────
export async function trainFromGames(options = {}) {
  if (isTraining) throw new Error('Training already in progress');
  isTraining = true;

  const {
    modelPath = DEFAULT_MODEL,
    epochs    = 10,
    batchSize = 64,
    games     = [],
  } = options;

  let tmpBin = null;

  try {
    await ensureBinaries();

    const diag = diagnoseGames(games);
    console.log(`📊 Dataset: ${diag.games} games | decisive: ${diag.decisive} (${diag.decisiveRate}) | draw_limit: ${diag.drawLimit} | other: ${diag.otherDraw}`);
    console.log(`   Moves: ${diag.totalMoves} total | with NN data: ${diag.withNN} (${diag.nnCoverage})`);

    if (diag.withNN === 0) {
      console.warn('⚠️  No moves have _nnFloat32 — generate new games with POST /api/selfPlay');
      return { trained: false, samples: 0, message: 'No _nnFloat32 data.', diagnosis: diag };
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

    // Log distribución
    const buckets = Array(10).fill(0);
    for (const s of allScores) buckets[Math.min(9, Math.floor((s + 1) / 2 * 10))]++;
    const labels = ['-1.0','-0.8','-0.6','-0.4','-0.2',' 0.0',' 0.2',' 0.4',' 0.6',' 0.8'];
    console.log(`📈 Target distribution (${allInputs.length} samples):`);
    for (let i = 0; i < 10; i++) {
      const bar = '█'.repeat(Math.round((buckets[i] / allInputs.length) * 36));
      console.log(`   ${labels[i]}: ${bar} ${buckets[i]}`);
    }

    // Escribir binario temporal — sin JSON, puro memcpy de floats
    tmpBin = path.join(os.tmpdir(), `nn_train_${Date.now()}.bin`);
    console.log(`💾 Writing binary dataset (${allInputs.length} × ${allInputs[0].length} floats)...`);
    const t0 = Date.now();
    writeDatasetBin(tmpBin, allInputs, allScores);
    console.log(`   Done in ${Date.now() - t0} ms — ${(fs.statSync(tmpBin).size / 1024 / 1024).toFixed(1)} MB`);

    console.log(`🧠 Training GPU: ${allInputs.length} samples, ${epochs} epochs, batch ${batchSize}...`);
    const result = await runTrainBinary(modelPath, epochs, batchSize, tmpBin);
    console.log(`✅ Done — MSE: ${result.final_mse?.toFixed(6) ?? '?'}`);

    return { trained: true, samples: allInputs.length, ...result, diagnosis: diag };

  } finally {
    isTraining = false;
    if (tmpBin) fs.unlink(tmpBin, () => {});
  }
}

// ── Ejecutar binario ──────────────────────────────────────────────────────────
function runTrainBinary(modelPath, epochs, batchSize, dataBin) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TRAIN_BIN, [modelPath, String(epochs), String(batchSize), dataBin], {
      cwd: NN_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin ignorado — datos van por archivo
      env: GPU_ENV,
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      stderr += d.toString();
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
  });
}

export async function trainBinDirect(dataBin, epochs = 10, batchSize = 64, modelPath = DEFAULT_MODEL) {
  if (isTraining) throw new Error('Training already in progress');
  isTraining = true;

  try {
    await ensureBinaries();
    console.log(`🧠 Training GPU from binary dataset: ${dataBin}`);
    const result = await runTrainBinary(modelPath, epochs, batchSize, dataBin);
    return result;
  } finally {
    isTraining = false;
  }
}

// ── Predicción ────────────────────────────────────────────────────────────────
export async function predictScore(nnEncoding, modelPath = DEFAULT_MODEL) {
  return new Promise(resolve => {
    const proc = spawn(path.join(NN_DIR, 'nn_gpu'), ['--predict', modelPath], {
      cwd: NN_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: GPU_ENV,
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

export default { trainFromGames, trainBinDirect, predictScore, getModelInfo, diagnoseGames };