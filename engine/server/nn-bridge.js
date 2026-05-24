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
import fsp               from 'node:fs/promises';
import os                from 'node:os';
import pako              from 'pako';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const NN_DIR        = path.join(__dirname, '..', '..', 'neural_network_gpu');
const TRAIN_BIN     = path.join(NN_DIR, 'nn_train');
const PREDICT_BIN   = path.join(NN_DIR, 'nn_predict');
const KERNEL_FILE   = path.join(NN_DIR, 'nn_kernel.cl');
const DEFAULT_MODEL = path.join(NN_DIR, 'model.bin');

// Variables de entorno para que Rusticl exponga la RX 570 como GPU OpenCL
const GPU_ENV = { ...process.env, RUSTICL_ENABLE: 'radeonsi' };

let isTraining = false;
const PREDICT_CACHE_MAX = 8192;
const predictCache = new Map();
let ensureBinariesPromise = null;

async function ensureBinaries() {
  if (ensureBinariesPromise) {
    return ensureBinariesPromise;
  }
  ensureBinariesPromise = (async () => {
    let compileNeeded = false;

    try {
      await fsp.access(TRAIN_BIN);
      await fsp.access(path.join(NN_DIR, 'nn_gpu'));
      await fsp.access(PREDICT_BIN);
    } catch {
      compileNeeded = true;
    }

    if (!compileNeeded) {
      try {
        const binStat = await fsp.stat(TRAIN_BIN);
        const srcFiles = await fsp.readdir(path.join(NN_DIR, 'src'));
        for (const fileName of srcFiles) {
          if (!fileName.endsWith('.cpp') && !fileName.endsWith('.h')) continue;
          const fileStat = await fsp.stat(path.join(NN_DIR, 'src', fileName));
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
      console.log('⚙️  Compiling nn_train, nn_gpu and nn_predict...');
      const { execSync } = await import('node:child_process');
      execSync('make nn_train nn_gpu nn_predict', { cwd: NN_DIR, stdio: 'inherit' });
    }

    try {
      await fsp.access(KERNEL_FILE);
    } catch {
      throw new Error(`Missing OpenCL kernel file: ${KERNEL_FILE}`);
    }
  })();

  try {
    return await ensureBinariesPromise;
  } catch (err) {
    ensureBinariesPromise = null;
    throw err;
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

// ── Escribe dataset como binario puro — streaming incremental ─────────────────
// OLD: cargaba todos los allInputs[] en memoria (podía ser GBs).
// NEW: escribe cada fila directamente al fd en vez de acumular en RAM.
// Formato: [int32 n_samples][int32 input_dim][float32*n*dim][float32*n]
// El header se escribe al final (seek a byte 0) cuando se conoce n_samples.
// ES: streaming incremental — evita OOM con datasets grandes.
function writeDatasetBin(filePath, allInputs, allScores) {
  const n        = allInputs.length;
  if (n === 0) { fs.writeFileSync(filePath, Buffer.alloc(8)); return; }
  const inputDim = allInputs[0].length;

  const fd = fs.openSync(filePath, 'w');
  try {
    // Reserve 8 bytes for header (filled at the end)
    // ES: Reservar 8 bytes para header (se rellena al final)
    fs.writeSync(fd, Buffer.alloc(8));

    const xBuf = Buffer.allocUnsafe(inputDim * 4);
    for (let i = 0; i < n; i++) {
      const row = allInputs[i];
      for (let j = 0; j < inputDim; j++) xBuf.writeFloatLE(row[j], j * 4);
      fs.writeSync(fd, xBuf);
    }

    const yBuf = Buffer.allocUnsafe(n * 4);
    for (let i = 0; i < n; i++) yBuf.writeFloatLE(allScores[i], i * 4);
    fs.writeSync(fd, yBuf);

    // Write header at offset 0
    // ES: Escribir header al offset 0
    const header = Buffer.allocUnsafe(8);
    header.writeInt32LE(n,        0);
    header.writeInt32LE(inputDim, 4);
    fs.writeSync(fd, header, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }
}

// ── Versión streaming para archivos grandes: escribe fila a fila sin acumular ──
// Identical binary format — can be called from trainFromGameFiles to avoid
// holding all allInputs[] in memory simultaneously.
// ES: versión streaming — igual formato, sin acumular en RAM.
export async function buildBinFromFiles(options = {}) {
  const { gamesDir, fileNames = [], outPath } = options;
  if (!gamesDir || !outPath || fileNames.length === 0) {
    return { nSamples: 0, inputDim: 0 };
  }

  const fd = fs.openSync(outPath, 'w');
  let nSamples = 0, inputDim = 0;
  const scores = [];

  try {
    fs.writeSync(fd, Buffer.alloc(8)); // header placeholder

    const BATCH = 20;
    for (let bs = 0; bs < fileNames.length; bs += BATCH) {
      const be       = Math.min(bs + BATCH, fileNames.length);
      const contents = await Promise.all(
        fileNames.slice(bs, be).map(f =>
          fsp.readFile(path.join(gamesDir, f), 'utf8').catch(() => null)
        )
      );
      for (const raw of contents) {
        if (!raw) continue;
        let game;
        try { game = JSON.parse(raw); } catch { continue; }
        if (!game.moves?.length) continue;
        const { inputs, scores: rowScores } = buildTargets(game);
        for (let ri = 0; ri < inputs.length; ri++) {
          const floats = inputs[ri];
          const score  = rowScores[ri];
          if (inputDim === 0) inputDim = floats.length;
          const xBuf = Buffer.allocUnsafe(floats.length * 4);
          for (let j = 0; j < floats.length; j++) xBuf.writeFloatLE(floats[j], j * 4);
          fs.writeSync(fd, xBuf);
          scores.push(score);
          nSamples++;
        }
      }
      contents.length = 0;
      if (typeof global.gc === 'function') global.gc();
    }

    const yBuf = Buffer.allocUnsafe(nSamples * 4);
    for (let i = 0; i < nSamples; i++) yBuf.writeFloatLE(scores[i], i * 4);
    fs.writeSync(fd, yBuf);

    const header = Buffer.allocUnsafe(8);
    header.writeInt32LE(nSamples, 0);
    header.writeInt32LE(inputDim, 4);
    fs.writeSync(fd, header, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }
  return { nSamples, inputDim };
}

function hashNNEncoding(nnEncoding) {
  const floats = nnEncoding instanceof Float32Array ? nnEncoding : Float32Array.from(nnEncoding);
  const bytes = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return `${floats.length}_${hash}`;
}

function writePredictInputBin(filePath, nnEncoding) {
  const floats = nnEncoding instanceof Float32Array ? nnEncoding : Float32Array.from(nnEncoding);
  const buf = Buffer.allocUnsafe(4 + floats.length * 4);
  buf.writeInt32LE(floats.length, 0);
  Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).copy(buf, 4);
  fs.writeFileSync(filePath, buf);
}

function runPredictBinary(modelPath, inputBin) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PREDICT_BIN, [modelPath, inputBin], {
      cwd: NN_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: GPU_ENV,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { if (stderr.length < 300) stderr += d.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`nn_predict exit ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result.score ?? null);
      } catch (e) {
        reject(new Error(`Invalid nn_predict output: ${e.message}`));
      }
    });

    proc.on('error', reject);
  });
}

// ── Training from game objects (in-memory) ────────────────────────────────────
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

    // Escribir binario temporal
    tmpBin = path.join(os.tmpdir(), `nn_train_${Date.now()}.bin`);
    console.log(`💾 Writing binary dataset (${allInputs.length} × ${allInputs[0].length} floats)...`);
    const t0 = Date.now();
    writeDatasetBin(tmpBin, allInputs, allScores);
    console.log(`   Done in ${Date.now() - t0} ms — ${(fs.statSync(tmpBin).size / 1024 / 1024).toFixed(1)} MB`);

    console.log(`🧠 Training GPU: ${allInputs.length} samples, ${epochs} epochs, batch ${batchSize}...`);
    const result = await runTrainBinary(modelPath, epochs, batchSize, tmpBin);
    predictCache.clear();
    console.log(`✅ Done — MSE: ${result.final_mse?.toFixed(6) ?? '?'}`);

    return { trained: true, samples: allInputs.length, ...result, diagnosis: diag };

  } finally {
    isTraining = false;
    if (tmpBin) fs.unlink(tmpBin, () => {});
  }
}

// ── Training DIRECTLY from game files on disk — streaming, no RAM accumulation ──
// OLD: acumulaba todos los inputs en allInputs[] (podía ser GBs en RAM).
// NEW: escribe cada muestra directamente al .bin vía buildBinFromFiles — O(batch) RAM.
// ES: versión streaming — sin acumulación en RAM, O(lote) en memoria.
export async function trainFromGameFiles(options = {}) {
  if (isTraining) throw new Error('Training already in progress');
  isTraining = true;

  const {
    modelPath   = DEFAULT_MODEL,
    epochs      = 10,
    batchSize   = 64,
    gamesDir    = null,
    fileNames   = [],
  } = options;

  if (!gamesDir || fileNames.length === 0) {
    isTraining = false;
    return { trained: false, samples: 0, message: 'No games directory or files specified.' };
  }

  let tmpBin = null;

  try {
    await ensureBinaries();

    tmpBin = path.join(os.tmpdir(), `nn_train_files_${Date.now()}.bin`);
    console.log(`💾 Streaming binary dataset from ${fileNames.length} game files...`);
    const t0 = Date.now();

    // STREAMING: write row-by-row without loading all inputs into RAM
    // ES: STREAMING: escribir fila a fila sin cargar todos los inputs en RAM
    const { nSamples, inputDim } = await buildBinFromFiles({ gamesDir, fileNames, outPath: tmpBin });

    if (nSamples === 0) {
      return { trained: false, samples: 0, message: 'No usable training samples found.' };
    }

    const mb = (fs.statSync(tmpBin).size / 1024 / 1024).toFixed(1);
    console.log(`📊 ${fileNames.length} files → ${nSamples} samples, ${inputDim} dims, ${mb} MB (${Date.now()-t0}ms)`);

    console.log(`🧠 GPU Training: ${nSamples} samples, ${epochs} epochs, batch ${batchSize}...`);
    const result = await runTrainBinary(modelPath, epochs, batchSize, tmpBin);
    predictCache.clear();
    console.log(`✅ NN training done — MSE: ${result.final_mse?.toFixed(6) ?? '?'}`);

    return {
      trained: true,
      samples: nSamples,
      gamesWithData: nSamples,  // approx — exact count not tracked in streaming mode
      ...result,
    };

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
      stdio: ['ignore', 'pipe', 'pipe'],
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
  await ensureBinaries();
  const key = `${modelPath}|${hashNNEncoding(nnEncoding)}`;
  if (predictCache.has(key)) return predictCache.get(key);
  const tmpBin = path.join(os.tmpdir(), `nn_predict_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
  try {
    writePredictInputBin(tmpBin, nnEncoding);
    const score = await runPredictBinary(modelPath, tmpBin);
    if (typeof score === 'number') {
      predictCache.set(key, score);
      if (predictCache.size > PREDICT_CACHE_MAX) {
        const oldest = predictCache.keys().next().value;
        if (oldest) predictCache.delete(oldest);
      }
    }
    return score;
  } finally {
    fs.unlink(tmpBin, () => {});
  }
}

// ── Info del modelo ───────────────────────────────────────────────────────────
export async function getModelInfo(modelPath = DEFAULT_MODEL) {
  try {
    const stat = await fsp.stat(modelPath);
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

export default { trainFromGames, trainFromGameFiles, trainBinDirect, predictScore, getModelInfo, diagnoseGames };