// server.js
import express from 'express';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'worker_threads';
import { SIDE } from '../constants.js';
import { trainBinDirect, getModelInfo, predictScore, trainFromGameFiles } from './nn-bridge.js';
import pako from 'pako';

import {
  getAllLegalMoves, applyMove, executeDrop,
  afterMoveEvaluation, isKingInCheck, executeArcherAmbush,
  isPromotionAvailableForMove, getLegalMovesForSquare, isDropLegal,
} from '../rules/index.js';
import { chooseBlackBotMove, evaluate, computeFullHash } from '../ai/index.js';
import { isPalaceSquare, opponent } from '../constants.js';

const PIECE_VALUES = {
  king:0, queen:950, general:560, elephant:240, priest:400,
  horse:320, cannon:450, tower:520, carriage:390, archer:450,
  pawn:110, crossbow:240,
};
const PROMOTED_VALUES = {
  pawn:240, tower:650, horse:430, elephant:320, priest:540, cannon:540,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR  = path.join(__dirname, '..', '..');
const MEMORY_FILE = path.join(__dirname, '..', 'data', 'ai-memory.json');
app.use(express.json({ limit: '50mb' }));
app.use(express.static(ROOT_DIR));

// ── FIX-5: ensureMemoryFile sólo actúa una vez — la bandera evita el fs.access
// en cada request al hot path de /api/memory.
// ES: bandera para evitar fs.access redundante en cada request.
let memoryFileReady = false;
const GAMES_DIR = path.join(ROOT_DIR, 'games');
async function ensureMemoryFile() {
  if (memoryFileReady) return;
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(MEMORY_FILE, JSON.stringify({
      moveScores: [], featureScores: [], blunderMoves: [], drawPositions: [],
      patternWeights: {
        centerControl: 1, pieceActivity: 1, kingSafety: 1,
        materialBalance: 1, pawnStructure: 1, palacePressure: 1,
      },
      gamesPlayed: 0, gamesWon: 0,
    }, null, 2));
  }
  memoryFileReady = true;
}

app.get('/api/memory', async (_req, res) => {
  await ensureMemoryFile();
  const raw = await fs.readFile(MEMORY_FILE, 'utf8');
  res.type('json').send(raw);
});

app.post('/api/memory', async (req, res) => {
  await ensureMemoryFile();
  await fs.writeFile(MEMORY_FILE, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

/* ---------- Guardado de partidas (COMPRIMIDO) ---------- */
app.post('/api/saveGame', async (req, res) => {
  try {
    let game;
    if (req.body && Object.keys(req.body).length > 0) {
      game = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      let jsonString;
      try {
        jsonString = pako.ungzip(buffer, { to: 'string' });
      } catch {
        return res.status(400).json({ error: 'Data corrupted (invalid gzip)' });
      }
      game = JSON.parse(jsonString);
    }

    if (!game.moves || !game.finalStatus) {
      return res.status(400).json({ error: 'There are missing data (moves, finalStatus)' });
    }

    await fs.mkdir(GAMES_DIR, { recursive: true });
    const name = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    await fs.writeFile(path.join(GAMES_DIR, name), JSON.stringify(game, null, 2), 'utf8');
    console.log(`✔ Game saved: ${name}`);
    res.json({ ok: true, file: name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Saving error' });
  }
});

// ── FIX-3: saveGameDirect — guarda a disco sin round-trip HTTP.
// NOTA: Se guarda como .json plano (sin comprimir) para que el timeline
// del frontend (replay-analyzer.js) pueda leerlo directamente.
// ES: guardado directo a disco como JSON plano.
async function saveGameDirect(game) {
  if (!game.moves || !game.finalStatus) throw new Error('Missing data (moves, finalStatus)');
  await fs.mkdir(GAMES_DIR, { recursive: true });
  const name = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
  await fs.writeFile(path.join(GAMES_DIR, name), JSON.stringify(game), 'utf8');
  return name;
}

/* ---------- Aprender de partidas guardadas ---------- */
app.post('/api/learnFromGames', async (_req, res) => {
  try {
    const result = await learnFromGamesDirect();
    res.json(result);
  } catch (e) {
    console.error('Error en learnFromGames:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── FIX-2 + FIX-3: learnFromGamesDirect — lógica extraída para llamarla
// directamente desde selfPlay sin un fetch() interno.
// ── FIX-3: lectura de archivos en paralelo con Promise.all() en lugar de for+await.
// ES: lógica de aprendizaje directa (sin fetch interno) + lectura paralela.
async function learnFromGamesDirect() {
  await ensureMemoryFile();
  const memRaw = await fs.readFile(MEMORY_FILE, 'utf8');
  const memory = JSON.parse(memRaw);

  memory.moveScores    = new Map(memory.moveScores    ?? []);
  memory.featureScores = new Map(memory.featureScores ?? []);
  memory.blunderMoves  = new Map(memory.blunderMoves  ?? []);
  memory.drawPositions = new Map(memory.drawPositions ?? []);

  let fileNames = [];
  try {
    const all = await fs.readdir(GAMES_DIR);
    fileNames = all.filter(f => f.endsWith('.json') && !f.includes('processed'));
  } catch {
    return { ok: true, learned: 0, message: 'There are no saved games available' };
  }

  if (fileNames.length === 0) {
    return { ok: true, learned: 0, message: 'There are no new games to learn from' };
  }

  const BLUNDER_THRESH = 200;
  const MISTAKE_THRESH = 80;
  let learned = 0;

  // FIX-9: Procesar archivos en lotes de 10 en vez de Promise.all masivo.
  // Cada archivo es ~42MB → batch de 10 = ~420MB pico seguro para heap de 4GB.
  // ES: procesamiento por lotes para evitar OOM con 17GB de partidas.
  const BATCH_SIZE = 10;

  for (let batchStart = 0; batchStart < fileNames.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, fileNames.length);
    const batchNames = fileNames.slice(batchStart, batchEnd);

    // Leer solo este lote en paralelo
    const batchContents = await Promise.all(
      batchNames.map(f => fs.readFile(path.join(GAMES_DIR, f), 'utf8').catch(() => null))
    );

    for (let bi = 0; bi < batchNames.length; bi++) {
      const fi = batchStart + bi;
      const raw = batchContents[bi];
      if (!raw) continue;
      try {
        const game = JSON.parse(raw);
        if (!game.moves || !Array.isArray(game.moves) || game.moves.length === 0) continue;

        let result = 'draw';
        if (game.finalStatus === 'checkmate' || game.finalStatus === 'palacemate') {
          const lastMove = game.moves[game.moves.length - 1];
          result = (lastMove?.side === 'black') ? 'win' : 'loss';
        }
        const gameDelta = result === 'win' ? 1 : result === 'loss' ? -1 : 0;

        if (result === 'draw') {
          const seenHashes = new Set();
          for (const m of game.moves) {
            if (m.positionHash) seenHashes.add(m.positionHash);
          }
          const weight = game.finalStatus === 'draw_move_limit' ? 2 : 1;
          for (const hash of seenHashes) {
            const count = (memory.drawPositions.get(hash) || 0) + weight;
            if (count <= 5) memory.drawPositions.set(hash, count);
          }
        }

        for (const m of game.moves) {
          if (!m) continue;
          const mk = m.moveKeyStr ?? null;
          const fk = m.featureKey ?? null;
          const evalBefore = m.evalBefore ?? null;
          const evalAfter  = m.evalAfter  ?? null;

          if (mk && evalBefore !== null && evalAfter !== null) {
            const side  = m.side ?? 'black';
            const sign  = side === 'black' ? 1 : -1;
            const moveDelta = (evalAfter - evalBefore) * sign;

            const prev = memory.moveScores.get(mk) ?? { total: 0, count: 0 };
            prev.total += moveDelta;
            prev.count++;
            memory.moveScores.set(mk, prev);

            if (moveDelta <= -BLUNDER_THRESH) {
              const pen = memory.blunderMoves.get(mk) ?? 0;
              memory.blunderMoves.set(mk, pen + Math.abs(moveDelta));
            } else if (moveDelta <= -MISTAKE_THRESH) {
              const pen = memory.blunderMoves.get(mk) ?? 0;
              memory.blunderMoves.set(mk, pen + Math.abs(moveDelta) * 0.4);
            }
          }

          if (fk) {
            const prev = memory.featureScores.get(fk) ?? { total: 0, count: 0 };
            prev.total += gameDelta;
            prev.count++;
            memory.featureScores.set(fk, prev);
          }
        }

        if (result !== 'draw') {
          updatePatternWeights(memory, result, game.moves);
          memory.gamesPlayed = (memory.gamesPlayed ?? 0) + 1;
          if (result === 'win') memory.gamesWon = (memory.gamesWon ?? 0) + 1;
        }
        learned++;

        // Rename processed file (non-blocking, best-effort)
        const processedName = fileNames[fi].replace('.json', '.processed.json');
        fs.rename(
          path.join(GAMES_DIR, fileNames[fi]),
          path.join(GAMES_DIR, processedName)
        ).catch(() => {});
      } catch (e) {
        console.error(`Error procesando ${fileNames[fi]}:`, e.message);
      }
    }

    // Liberar lote de memoria antes del siguiente
    batchContents.length = 0;
    if (typeof global.gc === 'function') {
      global.gc();
    }
    console.log(`📚 Batch ${Math.ceil(batchEnd / BATCH_SIZE)}/${Math.ceil(fileNames.length / BATCH_SIZE)} (${learned}/${fileNames.length} games)`);
  }

  const toSave = {
    ...memory,
    moveScores:    [...memory.moveScores.entries()],
    featureScores: [...memory.featureScores.entries()],
    blunderMoves:  [...memory.blunderMoves.entries()],
    drawPositions: [...memory.drawPositions.entries()],
  };

  if (toSave.moveScores.length > 4000)
    toSave.moveScores = toSave.moveScores
      .sort((a, b) => a[1].count - b[1].count)
      .slice(Math.floor(toSave.moveScores.length * 0.2));

  await fs.writeFile(MEMORY_FILE, JSON.stringify(toSave, null, 2));
  console.log(`✔ Aprendido de ${learned} partidas`);
  return { ok: true, learned, gamesPlayed: memory.gamesPlayed };
}

/* ---------- Estadísticas ---------- */
app.get('/api/memoryStats', async (_req, res) => {
  try {
    await ensureMemoryFile();
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    const mem = JSON.parse(raw);
    const pending = await fs.readdir(GAMES_DIR).then(
      files => files.filter(f => (f.endsWith('.json') || f.endsWith('.json.gz')) && !f.includes('processed')).length
    ).catch(() => 0);

    res.json({
      gamesPlayed:   mem.gamesPlayed ?? 0,
      gamesWon:      mem.gamesWon    ?? 0,
      winRate:       mem.gamesPlayed > 0 ? ((mem.gamesWon / mem.gamesPlayed) * 100).toFixed(1) + '%' : '0%',
      moveMemory:    (mem.moveScores    ?? []).length,
      featureMemory: (mem.featureScores ?? []).length,
      blunders:      (mem.blunderMoves  ?? []).length,
      drawMemory:    (mem.drawPositions ?? []).length,
      pendingGames:  pending,
      patternWeights: mem.patternWeights ?? {},
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function updatePatternWeights(memory, result, moves) {
  const LEARNING_RATE = 0.12;
  const factor = result === 'win' ? 1 + LEARNING_RATE
               : result === 'loss' ? 1 - LEARNING_RATE * 0.5 : 1;

  let cc=0, pa=0, ks=0, mb=0, pp=0, n=0;
  for (const m of moves) {
    if (!m?.metrics) continue;
    cc += m.metrics.centerControl   ?? 0;
    pa += m.metrics.pieceActivity   ?? 0;
    ks += m.metrics.kingSafety      ?? 0;
    mb += m.metrics.materialBalance ?? 0;
    pp += m.metrics.palacePressure  ?? 0;
    n++;
  }
  if (n === 0) return;

  const w = memory.patternWeights ?? {};
  const clamp = v => Math.min(2, Math.max(0.3, v));
  const adj   = avg => Math.abs(avg - 0.5) > 0.08;

  if (adj(cc/n)) w.centerControl   = clamp((w.centerControl   ?? 1) * factor);
  if (adj(pa/n)) w.pieceActivity   = clamp((w.pieceActivity   ?? 1) * factor);
  if (adj(ks/n)) w.kingSafety      = clamp((w.kingSafety      ?? 1) * factor);
  if (adj(mb/n)) w.materialBalance = clamp((w.materialBalance ?? 1) * factor);
  if (adj(pp/n)) w.palacePressure  = clamp((w.palacePressure  ?? 1) * factor);

  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const tgt   = Object.keys(w).length;
  for (const k in w) w[k] = w[k] / total * tgt;
  memory.patternWeights = w;
}

/* ─── SELF‑PLAY CON WORKER THREADS ─── */
const MAX_WORKERS = 4;

app.post('/api/selfPlay', async (req, res) => {
  const { games = 10, maxDepth = 4, timeLimitMs = 500 } = req.body;
  res.json({ ok: true, message: `Self‑play of ${games} games started (depth ${maxDepth}, ${timeLimitMs}ms, ${MAX_WORKERS} workers).` });

  (async () => {
    const botParams = { maxDepth, timeLimitMs };
    let completed = 0;

    const runOneGame = () => new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'selfplay-worker.js');
      const worker = new Worker(workerPath, { workerData: { botParams } });

      worker.on('message', async (result) => {
        try {
          const { moves, finalStatus, finalMessage, _nnFloat32 } = result;

          let gameResult = 'draw';
          if (finalStatus === 'checkmate' || finalStatus === 'palacemate') {
            const lastSide = moves[moves.length - 1]?.side;
            gameResult = lastSide === SIDE.BLACK ? 'win' : 'loss';
          }

          // FIX-7: Worker ahora indexa por posición ordinal (idx) en lugar de
          // usar indexOf(m) que era O(n²). El map usa la clave idx directamente.
          // ES: indexado O(1) por posición ordinal en lugar de O(n²) con indexOf.
          const nnMap = {};
          if (_nnFloat32 && Array.isArray(_nnFloat32)) {
            for (const entry of _nnFloat32) {
              nnMap[entry.idx] = entry.nn;
            }
          }

          const gameData = {
            id:         Date.now() + Math.random(),
            timestamp:  new Date().toISOString(),
            finalStatus,
            result:     gameResult,
            totalMoves: moves.length,
            finalMessage,
            moves: moves.map((m, idx) => {
              const nnEncoded = nnMap[idx];
              return {
                turn:         idx + 1,
                side:         m.side === SIDE.BLACK ? 'black' : 'white',
                moveKeyStr:   m.moveKeyStr,
                featureKey:   m.featureKey,
                evalBefore:   m.evalBefore,
                evalAfter:    m.evalAfter,
                metrics:      m.metrics,
                notation:     m.notation ?? '',
                positionHash: m.positionHash,
                stateAfter:   m.stateAfter ?? undefined,
                ...(nnEncoded ? { _nnFloat32: nnEncoded } : {}),
              };
            }),
          };

          // FIX-2: guardar directamente a disco sin fetch() interno
          // ES: guardado directo — elimina round-trip HTTP en el mismo proceso
          await saveGameDirect(gameData);

          completed++;
          console.log(`✔ Worker finished games (${completed}/${games})`);
          resolve();
        } catch (e) {
          console.error('Error saving game from worker:', e);
          reject(e);
        }
      });

      worker.on('error', reject);
    });

    for (let i = 0; i < games; i += MAX_WORKERS) {
      const batch = Math.min(MAX_WORKERS, games - i);
      const promises = [];
      for (let j = 0; j < batch; j++) promises.push(runOneGame());
      await Promise.all(promises);
    }

    // FIX-2: llamar directamente en lugar de fetch() interno
    // ES: llamada directa — sin round-trip HTTP al mismo servidor
    await learnFromGamesDirect();

    // 🧠 Auto-entrenar la red neuronal con TODAS las partidas disponibles
    // (procesadas y no procesadas) después de cada sesión de self-play
    // ES: Auto-trigger NN training from ALL game files after self-play
    try {
      const allFiles = await fs.readdir(GAMES_DIR);
      const gameFiles = allFiles.filter(f => f.endsWith('.json') || f.endsWith('.processed.json'));
      if (gameFiles.length >= 5) {
        console.log(`🧠 Auto-training NN from ${gameFiles.length} game files...`);
        const nnResult = await trainFromGameFiles({
          gamesDir: GAMES_DIR,
          fileNames: gameFiles,
          epochs: 10,
          batchSize: 64,
        });
        console.log(`🤖 NN training: ${nnResult.trained ? '✅' : '⚠️'} ${nnResult.samples} samples`);
      } else {
        console.log(`🧠 Skipping NN auto-train: only ${gameFiles.length} games (need >= 5)`);
      }
    } catch (nnErr) {
      console.error('⚠️ NN auto-training error (non-fatal):', nnErr.message);
    }

    console.log(`✔ Self‑play finished: ${completed}/${games} games.`);
  })().catch(console.error);
});

/* ════════════════════════════════════════
   🧠 Endpoints: Red Neuronal GPU (OpenCL)
   ════════════════════════════════════════ */

function buildTargetsServer(game) {
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

  const rows = [];
  for (let i = 0; i < total; i++) {
    const move = moves[i];
    if (!move._nnFloat32) continue;
    const progress  = i / Math.max(total - 1, 1);
    const heuristic = Math.tanh((move.evalAfter ?? 0) / 300);

    let target;
    if (isDecisive) {
      const rw = 0.1 + 0.7 * progress;
      target = (1 - rw) * heuristic + rw * resultSign;
    } else if (isDrawLimit) {
      if (progress > 0.5) continue;
      target = heuristic * 0.25;
    } else {
      target = heuristic * 0.5;
    }

    const floats = Array.isArray(move._nnFloat32) ? move._nnFloat32 : Array.from(move._nnFloat32);
    rows.push({ floats, score: Math.max(-1, Math.min(1, target)) });
  }
  return rows;
}

async function buildBinIncremental(fileNames, outPath) {
  const fd = fssync.openSync(outPath, 'w');
  try {
    fssync.writeSync(fd, Buffer.alloc(8));

    let nSamples = 0;
    let inputDim = 0;
    const scores = [];

    const TRAIN_BATCH = 10;
    for (let batchStart = 0; batchStart < fileNames.length; batchStart += TRAIN_BATCH) {
      const batchEnd = Math.min(batchStart + TRAIN_BATCH, fileNames.length);
      const batchNames = fileNames.slice(batchStart, batchEnd);

      const batchContents = await Promise.all(
        batchNames.map(async f => {
          try {
            const buf = await fs.readFile(path.join(GAMES_DIR, f));
            return f.endsWith('.gz') ? pako.ungzip(buf, { to: 'string' }) : buf.toString('utf8');
          } catch {
            return null;
          }
        })
      );

      for (const raw of batchContents) {
        if (!raw) continue;
        let game;
        try {
          game = JSON.parse(raw);
        } catch {
          continue;
        }
        if (!game.moves?.length) continue;

        const rows = buildTargetsServer(game);
        for (const { floats, score } of rows) {
          if (inputDim === 0) inputDim = floats.length;
          const xBuf = Buffer.allocUnsafe(floats.length * 4);
          for (let j = 0; j < floats.length; j++) {
            xBuf.writeFloatLE(floats[j], j * 4);
          }
          fssync.writeSync(fd, xBuf);
          scores.push(score);
          nSamples++;
        }
      }

      batchContents.length = 0;
      if (typeof global.gc === 'function') global.gc();
    }

    const yBuf = Buffer.allocUnsafe(nSamples * 4);
    for (let i = 0; i < nSamples; i++) {
      yBuf.writeFloatLE(scores[i], i * 4);
    }
    fssync.writeSync(fd, yBuf);

    const header = Buffer.allocUnsafe(8);
    header.writeInt32LE(nSamples, 0);
    header.writeInt32LE(inputDim, 4);
    fssync.writeSync(fd, header, 0, 8, 0);

    return { nSamples, inputDim };
  } finally {
    fssync.closeSync(fd);
  }
}

app.post('/api/nn/train', async (req, res) => {
  try {
    const { epochs = 10, batchSize = 64 } = req.body ?? {};

    let fileNames = [];
    try {
      const all = await fs.readdir(GAMES_DIR);
      fileNames = all.filter(f => f.endsWith('.json') || f.endsWith('.json.gz'));
    } catch {}

    if (fileNames.length === 0) {
      return res.json({ ok: false, message: 'There are no saved games' });
    }

    const tmpBin = path.join(os.tmpdir(), `nn_train_${Date.now()}.bin`);
    console.log(`💾 Building binary dataset from ${fileNames.length} game files...`);

    try {
      const { nSamples, inputDim } = await buildBinIncremental(fileNames, tmpBin);
      if (nSamples === 0) {
        return res.json({ ok: false, message: 'No usable samples found' });
      }

      const stats = await fs.stat(tmpBin);
      console.log(`🧠 Training GPU: ${nSamples} samples, ${inputDim} dims, ${(stats.size / 1024 / 1024).toFixed(1)} MB, ${epochs} epochs...`);

      const result = await trainBinDirect(tmpBin, epochs, batchSize);

      console.log(`✅ GPU training done — MSE: ${result.final_mse?.toFixed(6) ?? '?'}`);
      res.json({ ok: true, samples: nSamples, ...result });
    } finally {
      try {
        if (fssync.existsSync(tmpBin)) fssync.unlinkSync(tmpBin);
      } catch (_err) {
        console.warn(`Unable to delete temporary bin file: ${tmpBin}`);
      }
    }
  } catch (e) {
    console.error('Error en /api/nn/train:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 🧠 trainAll: entrena desde TODOS los archivos de partida (procesados y no) ──
// ES: trainAll: trains from ALL game files (processed and unprocessed)
app.post('/api/nn/trainAll', async (req, res) => {
  try {
    const { epochs = 10, batchSize = 64 } = req.body ?? {};
    let allFiles = [];
    try {
      allFiles = await fs.readdir(GAMES_DIR);
    } catch {
      return res.json({ ok: false, message: 'Games directory not found' });
    }
    const gameFiles = allFiles.filter(f => f.endsWith('.json') || f.endsWith('.processed.json'));
    if (gameFiles.length === 0) {
      return res.json({ ok: false, message: 'No game files found' });
    }
    console.log(`🧠 /api/nn/trainAll: ${gameFiles.length} files, ${epochs} epochs, batch ${batchSize}`);
    const result = await trainFromGameFiles({
      gamesDir: GAMES_DIR,
      fileNames: gameFiles,
      epochs,
      batchSize,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('Error en /api/nn/trainAll:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/nn/info', async (_req, res) => {
  try {
    const modelInfo = await getModelInfo();
    res.json(modelInfo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const NN_INPUT_DIM = 13 * 13 * 24;

app.post('/api/nn/predict', async (req, res) => {
  console.log('[API] /api/nn/predict');
  try {
    const input = req.body?.input;
    if (!Array.isArray(input) && !(input instanceof Float32Array)) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid input array' });
    }
    const nnEncoding = Array.isArray(input) ? Float32Array.from(input) : input;
    if (nnEncoding.length !== NN_INPUT_DIM) {
      return res.status(400).json({
        ok: false,
        error: `Invalid input length: ${nnEncoding.length}. Expected ${NN_INPUT_DIM} floats.`,
      });
    }
    const score = await predictScore(nnEncoding);
    res.json({ ok: true, score });
  } catch (e) {
    console.error('Error en /api/nn/predict:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ─── Codificación para red neuronal ─── */
const PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
};
const NN_CHANNELS = 24;
function encodeBoardForNN(board) {
  const enc = new Float32Array(13 * 13 * NN_CHANNELS);
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) continue;
      const ch = PIECE_CHANNEL[p.type];
      if (ch === undefined) continue;
      const offset = p.side === SIDE.WHITE ? 0 : 12;
      enc[(r * 13 + c) * NN_CHANNELS + offset + ch] = 1.0;
    }
  }
  return enc;
}

// ── FIX-6: cloneStateForBot unificado — versión canónica usada tanto por server.js
// como referencia para selfplay.js. Incluye todos los campos requeridos por el motor.
// ES: versión única de cloneStateForBot — evita divergencia entre archivos.
function cloneStateForBot(state) {
  const board = new Array(13);
  for (let r = 0; r < 13; r++) {
    board[r] = new Array(13);
    for (let c = 0; c < 13; c++) {
      const p = state.board[r][c];
      board[r][c] = p ? { ...p } : null;
    }
  }
  return {
    board,
    turn: state.turn,
    selected: null,
    legalMoves: [],
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
    },
    promotionRequest: null,
    palaceTaken:  { white: state.palaceTaken?.white ?? false, black: state.palaceTaken?.black ?? false },
    palaceTimers: {
      white: { ...state.palaceTimers?.white ?? { pressure: 0, invaded: false, attackerSide: null } },
      black: { ...state.palaceTimers?.black ?? { pressure: 0, invaded: false, attackerSide: null } },
    },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove:            state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount:     state.repeatMoveCount ?? 0,
    history:             state.history ? [...state.history] : [],
    positionHistory:     state.positionHistory instanceof Map
                           ? new Map(state.positionHistory)
                           : Array.isArray(state.positionHistory)
                             ? new Map(state.positionHistory)
                             : new Map(),
    status:      state.status,
    message:     '',
    archerAmbush: null,
  };
}

// ── FIX-1: resolveAmbushAuto ahora sí captura piezas a reserva cuando corresponde.
// El bug original dejaba las piezas capturadas por el arquero sin ir a la reserva
// del bot, lo que rompía la paridad de material entre servidor y cliente.
// ES: ambush resolution correcta — las capturas del arquero van a la reserva.
function captureToReserveServer(state, captured, captorSide) {
  if (!captured) return;
  const type = captured.promoted
    ? (captured.type === 'pawn' ? 'crossbow' : captured.type)
    : captured.type;
  if (['tower', 'general', 'pawn', 'crossbow'].includes(type)) {
    state.reserves[captorSide].push({ id: `srv_${Date.now()}_${Math.random()}`, type, side: captorSide });
  }
}

function resolveAmbushAuto(ambush, side, state) {
  if (!ambush) return;
  if (ambush.type === 'autoCaptureAll') {
    for (const v of ambush.victims) {
      const victim = state.board[v.r]?.[v.c];
      if (victim) {
        // FIX-1: capturar a reserva antes de nullear la casilla
        captureToReserveServer(state, victim, side);
        state.board[v.r][v.c] = null;
      }
    }
  } else if (ambush.type === 'singleCapture') {
    const victim = state.board[ambush.victim.r]?.[ambush.victim.c];
    if (victim) {
      // FIX-1: ídem
      captureToReserveServer(state, victim, side);
      state.board[ambush.victim.r][ambush.victim.c] = null;
    }
  } else if (ambush.type === 'chooseCapture') {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < ambush.options.length; i++) {
      const opt = ambush.options[i];
      const base = PIECE_VALUES[opt.piece.type] ?? 0;
      let sc = opt.piece.promoted ? (PROMOTED_VALUES[opt.piece.type] ?? base + 120) : base;
      if (!opt.canRetreat) sc += 80;
      if (isPalaceSquare(opt.r, opt.c, opponent(side))) sc += 120;
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }
    // executeArcherAmbush ya maneja captureToReserve internamente
    executeArcherAmbush(state, { archerTo: ambush.archerTo, chosenIndex: bestIdx });
  }
}

function getBotParams(level = 5) {
  const params = [
    { maxDepth: 5,  timeLimitMs: 1500 }, { maxDepth: 6,  timeLimitMs: 2000 },
    { maxDepth: 7,  timeLimitMs: 2500 }, { maxDepth: 8,  timeLimitMs: 3000 },
    { maxDepth: 9,  timeLimitMs: 3500 }, { maxDepth: 10, timeLimitMs: 4000 },
    { maxDepth: 11, timeLimitMs: 4500 }, { maxDepth: 12, timeLimitMs: 5000 },
    { maxDepth: 13, timeLimitMs: 5500 }, { maxDepth: 14, timeLimitMs: 6000 },
  ];
  return params[Math.min(params.length - 1, level - 1)];
}

function isSameMove(move, legalMove) {
  if (!move || !legalMove) return false;
  if (Boolean(move.fromReserve) !== Boolean(legalMove.fromReserve)) return false;
  if (move.fromReserve) {
    return move.reserveIndex === legalMove.reserveIndex && move.to.r === legalMove.to.r && move.to.c === legalMove.to.c;
  }
  return move.from?.r === legalMove.from?.r && move.from?.c === legalMove.from?.c && move.to?.r === legalMove.to?.r && move.to?.c === legalMove.to?.c;
}
function isValidBotMove(state, move) {
  if (!move) return false;
  const legalMoves = getAllLegalMoves(state, state.turn);
  return legalMoves.some(m => isSameMove(move, m));
}

app.post('/api/botMove', async (req, res) => {
  try {
    const { state: clientState, difficulty } = req.body;
    const state = cloneStateForBot(clientState);
    const originalState = cloneStateForBot(clientState);
    const params = getBotParams(difficulty || 5);

    const { move, score } = chooseBlackBotMove(state, params);

    if (!move) return res.json({ move: null });

    // OPT-13: Validar que la casilla de origen tenga una pieza propia antes de
    // devolver el movimiento. Si el bot devuelve coordenadas inválidas (por
    // ejemplo por timeout en searchRoot con referencia corrupta), se rechaza.
    // ES: validate source square has own piece before returning move.
    if (!isValidBotMove(originalState, move)) {
      console.warn(`[botMove] Invalid move returned by AI — using fallback:`, move);
      const fallbackMoves = getAllLegalMoves(originalState, originalState.turn);
      if (fallbackMoves.length > 0) {
        const fm = fallbackMoves[0];
        const fallback = fm.fromReserve
          ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { r: fm.to.r, c: fm.to.c }, promotion: fm.promotion ?? false }
          : { from: { r: fm.from.r, c: fm.from.c }, to: { r: fm.to.r, c: fm.to.c }, promotion: fm.promotion ?? false };
        return res.json({ move: fallback });
      }
      return res.json({ move: null });
    }

    res.json({
      move: move.fromReserve
        ? { fromReserve: true, reserveIndex: move.reserveIndex, to: { r: move.to.r, c: move.to.c }, promotion: false }
        : { from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c }, promotion: move.promotion ?? false },
    });
  } catch (err) {
    console.error('/api/botMove error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  await ensureMemoryFile();
  console.log(`Servidor en http://localhost:${PORT}`);

  try {
    const files = await fs.readdir(GAMES_DIR);
    const pending = files.filter(f => (f.endsWith('.json') || f.endsWith('.json.gz')) && !f.includes('processed'));
    if (pending.length > 0) {
      console.log(`📚 ${pending.length} pending games, learning...`);
      // FIX-2: llamada directa en lugar de fetch() interno al arrancar
      await learnFromGamesDirect();
    }

    // 🧠 Auto-entrenar la red neuronal con partidas existentes al arrancar
    // (incluye .processed.json de sesiones anteriores)
    // ES: Auto-trigger NN training from ALL existing game files on startup
    try {
      const allFiles = await fs.readdir(GAMES_DIR);
      const gameFiles = allFiles.filter(f => f.endsWith('.json') || f.endsWith('.processed.json'));
      if (gameFiles.length >= 5) {
        console.log(`🧠 Auto-training NN from ${gameFiles.length} game files at startup...`);
        const nnResult = await trainFromGameFiles({
          gamesDir: GAMES_DIR,
          fileNames: gameFiles,
          epochs: 10,
          batchSize: 64,
        });
        if (nnResult.trained) {
          console.log(`🤖 NN trained ✅ — ${nnResult.samples} samples from ${nnResult.gamesWithData} games`);
        } else {
          console.log(`🤖 NN training skipped: ${nnResult.message}`);
        }
      } else {
        console.log(`🧠 Skipping NN auto-train at startup: only ${gameFiles.length} games (need >= 5)`);
      }
    } catch (nnErr) {
      console.error('⚠️ NN auto-training error at startup (non-fatal):', nnErr.message);
    }
  } catch {}
});