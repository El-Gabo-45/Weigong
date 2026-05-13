// server.js
// ES: server.js
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'worker_threads';
import { SIDE } from '../constants.js';
import { trainFromGames, getModelInfo } from './nn-bridge.js';
import pako from 'pako';

// ─── Funciones del juego (necesarias para el bot) ───
import {
  getAllLegalMoves, applyMove, executeDrop,
  afterMoveEvaluation, isKingInCheck, executeArcherAmbush,
  isPromotionAvailableForMove,
} from '../rules/index.js';
import { chooseBlackBotMove, evaluate, computeFullHash } from '../ai/index.js';
import { predictScore } from './nn-bridge.js';

// ═══════════════════════ AGREGADOS ═══════════════════════
import { isPalaceSquare, opponent } from '../constants.js';

const PIECE_VALUES = {
  king:0, queen:950, general:560, elephant:240, priest:400,
  horse:320, cannon:450, tower:520, carriage:390, archer:450,
  pawn:110, crossbow:240,
};
const PROMOTED_VALUES = {
  pawn:240, tower:650, horse:430, elephant:320, priest:540, cannon:540,
};
// ═════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = path.join(__dirname, '..', '..');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'ai-memory.json');
const GAMES_DIR   = path.join(ROOT_DIR, 'games');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(ROOT_DIR));

/* ---------- Memoria adaptativa ---------- */
async function ensureMemoryFile() {
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

    // Si el body ya fue parseado (por express.json), lo usamos directamente.
    // ES: Si el body ya fue parseado (por express.json), lo usamos directamente.
    if (req.body && Object.keys(req.body).length > 0) {
      game = req.body;
    } else {
      // Si no, leemos el stream crudo (compresión gzip desde el frontend).
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
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

/* ---------- Aprender de partidas guardadas ---------- */
app.post('/api/learnFromGames', async (_req, res) => {
  try {
    await ensureMemoryFile();
    const memRaw = await fs.readFile(MEMORY_FILE, 'utf8');
    const memory = JSON.parse(memRaw);

    memory.moveScores    = new Map(memory.moveScores    ?? []);
    memory.featureScores = new Map(memory.featureScores ?? []);
    memory.blunderMoves  = new Map(memory.blunderMoves  ?? []);
    memory.drawPositions = new Map(memory.drawPositions ?? []);

    let files = [];
    try {
      const all = await fs.readdir(GAMES_DIR);
      files = all.filter(f => f.endsWith('.json') && !f.includes('processed'));
    } catch {
      return res.json({ ok: true, learned: 0, message: 'There are no saved games available' });
    }

    if (files.length === 0) {
      return res.json({ ok: true, learned: 0, message: 'There are no new games to learn from' });
    }

    const DECAY = 0.02;
    const BLUNDER_THRESH = 200;
    const MISTAKE_THRESH = 80;
    let learned = 0;

    for (const file of files) {
      try {
        const raw  = await fs.readFile(path.join(GAMES_DIR, file), 'utf8');
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
            if (count <= 5) {
              memory.drawPositions.set(hash, count);
            }
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

        const processedName = file.replace('.json', '.processed.json');
        await fs.rename(path.join(GAMES_DIR, file), path.join(GAMES_DIR, processedName)).catch(() => {});
      } catch (e) {
        console.error(`Error procesando ${file}:`, e.message);
      }
    }

    const toSave = {
      ...memory,
      moveScores:    [...memory.moveScores.entries()],
      featureScores: [...memory.featureScores.entries()],
      blunderMoves:  [...memory.blunderMoves.entries()],
      drawPositions: [...memory.drawPositions.entries()],
    };

    if (toSave.moveScores.length > 4000)
      toSave.moveScores = toSave.moveScores.sort((a,b) => a[1].count - b[1].count).slice(Math.floor(toSave.moveScores.length * 0.2));

    await fs.writeFile(MEMORY_FILE, JSON.stringify(toSave, null, 2));

    console.log(`✔ Aprendido de ${learned} partidas`);
    res.json({ ok: true, learned, gamesPlayed: memory.gamesPlayed });
  } catch (e) {
    console.error('Error en learnFromGames:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Estadísticas ---------- */
app.get('/api/memoryStats', async (_req, res) => {
  try {
    await ensureMemoryFile();
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    const mem = JSON.parse(raw);
    const pending = await fs.readdir(GAMES_DIR).then(
      files => files.filter(f => f.endsWith('.json') && !f.includes('processed')).length
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

  const total = Object.values(w).reduce((a,b) => a+b, 0);
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
            const lastSide = moves[moves.length-1]?.side;
            gameResult = lastSide === SIDE.BLACK ? 'win' : 'loss';
          }

          const nnMap = {};
          if (_nnFloat32 && Array.isArray(_nnFloat32)) {
            for (const entry of _nnFloat32) {
              nnMap[entry.turn] = entry.nn;
            }
          }

          const gameData = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toISOString(),
            finalStatus,
            result: gameResult,
            totalMoves: moves.length,
            finalMessage,
            moves: moves.map((m, idx) => {
              const turn = idx + 1;
              const nnEncoded = nnMap[turn];
              return {
                turn,
                side: m.side === SIDE.BLACK ? 'black' : 'white',
                moveKeyStr: m.moveKeyStr,
                featureKey: m.featureKey,
                evalBefore: m.evalBefore,
                evalAfter: m.evalAfter,
                metrics: m.metrics,
                notation: m.notation ?? '',
                positionHash: m.positionHash,
                stateAfter: m.stateAfter ?? undefined,
                ...(nnEncoded ? { _nnFloat32: nnEncoded } : {}),
              };
            }),
          };

          await fetch(`http://localhost:${PORT}/api/saveGame`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gameData),
          });

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

    await fetch(`http://localhost:${PORT}/api/learnFromGames`, { method: 'POST' });
    console.log(`✔ Self‑play finished: ${completed}/${games} games.`);
  })().catch(console.error);
});

/* ════════════════════════════════════════
   🧠 Endpoints: Red Neuronal GPU (OpenCL)
   ════════════════════════════════════════ */

app.post('/api/nn/train', async (req, res) => {
  try {
    const { epochs = 10, batchSize = 64 } = req.body ?? {};

    let files = [];
    try {
      const all = await fs.readdir(GAMES_DIR);
      files = all.filter(f => f.endsWith('.json'));
    } catch {}

    if (files.length === 0) {
      return res.json({ ok: false, message: 'There are no saved games' });
    }

    const games = [];
    for (const file of files) {
      try {
        const raw = await fs.readFile(path.join(GAMES_DIR, file), 'utf8');
        const game = JSON.parse(raw);
        if (game.moves && game.moves.length > 0) games.push(game);
      } catch {}
    }

    console.log(`🧠 Training GPU with ${games.length} games...`);
    const result = await trainFromGames({ epochs, batchSize, games });

    console.log(`✅ GPU training: ${result.samples} muestras, MSE: ${result.final_mse?.toFixed(6) ?? '?'}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('Error en /api/nn/train:', e);
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

// ═══════════════════════════════════════
//  🆕 ENDPOINT DEL BOT CON RED NEURONAL
// ES: 🆕 ENDPOINT DEL BOT CON RED NEURONAL
// ═══════════════════════════════════════

/** Codifica un tablero para la red neuronal (misma que usas en el cliente) */
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

/** Clona el estado del juego (versión usada en el servidor) */
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
    turn:        state.turn,
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
    },
    palaceTaken:  { white: state.palaceTaken.white,  black: state.palaceTaken.black  },
    palaceTimers: {
      white: { ...state.palaceTimers.white },
      black: { ...state.palaceTimers.black },
    },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove:           state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount:    state.repeatMoveCount ?? 0,
    history:            state.history ? [...state.history] : [],
    positionHistory:    state.positionHistory instanceof Map ? new Map(state.positionHistory) : new Map(),
    status:   state.status,
    selected: null,
    legalMoves: [],
    message: '',
  };
}

/** Resuelve emboscadas automáticamente (copia de selfplay.js) */
function resolveAmbushAuto(ambush, side, state) {
  if (!ambush) return;
  if (ambush.type === 'autoCaptureAll') {
    for (const v of ambush.victims) {
      const victim = state.board[v.r]?.[v.c];
      if (victim) { state.board[v.r][v.c] = null; }
    }
  } else if (ambush.type === 'singleCapture') {
    const victim = state.board[ambush.victim.r]?.[ambush.victim.c];
    if (victim) { state.board[ambush.victim.r][ambush.victim.c] = null; }
  } else if (ambush.type === 'chooseCapture') {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < ambush.options.length; i++) {
      const opt = ambush.options[i];
      let sc = (opt.piece.promoted ? (PROMOTED_VALUES[opt.piece.type] ?? PIECE_VALUES[opt.piece.type] + 120) : (PIECE_VALUES[opt.piece.type] ?? 0));
      if (!opt.canRetreat) sc += 80;
      if (isPalaceSquare(opt.r, opt.c, opponent(side))) sc += 120;
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }
    executeArcherAmbush(state, { archerTo: ambush.archerTo, chosenIndex: bestIdx });
  }
}

/** Parámetros del bot según dificultad */
function getBotParams(level = 5) {
  const params = [
    { maxDepth: 5, timeLimitMs: 1500 }, { maxDepth: 6, timeLimitMs: 2000 },
    { maxDepth: 7, timeLimitMs: 2500 }, { maxDepth: 8, timeLimitMs: 3000 },
    { maxDepth: 9, timeLimitMs: 3500 }, { maxDepth: 10, timeLimitMs: 4000 },
    { maxDepth: 11, timeLimitMs: 4500 }, { maxDepth: 12, timeLimitMs: 5000 },
    { maxDepth: 13, timeLimitMs: 5500 }, { maxDepth: 14, timeLimitMs: 6000 },
  ];
  return params[Math.min(params.length - 1, level - 1)];
}

// Endpoint principal que el cliente llamará
app.post('/api/botMove', async (req, res) => {
  try {
    const { state: clientState, difficulty } = req.body;
    // Reconstruye el estado del juego a partir del JSON enviado por el cliente
    // ES: Reconstruye el estado del juego a partir del JSON enviado por el cliente
    const state = cloneStateForBot(clientState);
    const params = getBotParams(difficulty || 5);

    // 1. Obtener todos los movimientos legales
    // ES: 1. Obtener todos los movimientos legales
    const legalMoves = getAllLegalMoves(state, state.turn);
    if (legalMoves.length === 0) {
      return res.json({ move: null });
    }

    // 2. Evaluar cada movimiento legal con heurística + red
    const evalResults = await Promise.all(legalMoves.map(async (move) => {
      // Simular el movimiento en una copia
      // ES: Simular el movimiento en una copia
      const simState = cloneStateForBot(state);
      const simMove = { ...move, promotion: move.promotion ?? false };

      if (move.fromReserve) {
        if (!executeDrop(simState, move.reserveIndex, move.to)) return null;
      } else {
        applyMove(simState, simMove);
        // Resolver emboscada si aparece
        // ES: Resolver emboscada si aparece
        if (simState.archerAmbush) {
          resolveAmbushAuto(simState.archerAmbush, state.turn, simState);
        }
      }
      afterMoveEvaluation(simState);

      // Score heurístico
      const heurScore = evaluate(simState, computeFullHash(simState)).score;

      // Score de la red neuronal
      // ES: Score de la red neuronal
      const nnInput = encodeBoardForNN(simState.board);
      let nnScore = 0;
      try {
        const predicted = await predictScore(nnInput);
        nnScore = predicted ?? 0;
      } catch (e) {
        // Si falla la GPU, usamos solo heurística
        nnScore = 0;
      }

      return { move, heurScore, nnScore };
    }));

    // Filtrar movimientos válidos
    const valid = evalResults.filter(e => e !== null);

    // 3. Combinar heurística + red (ajusta los pesos a tu gusto)
    const NN_WEIGHT = 0.3;   // peso de la red
    let bestMove = null;
    let bestCombined = -Infinity;
    for (const ev of valid) {
      const combined = ev.heurScore + NN_WEIGHT * ev.nnScore;
      if (combined > bestCombined) {
        bestCombined = combined;
        bestMove = ev.move;
      }
    }

    // Fallback: si no hay movimiento válido, usamos el primer legal
    if (!bestMove) bestMove = legalMoves[0];

    res.json({ move: bestMove });
  } catch (err) {
    console.error('/api/botMove error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Al iniciar, aprender automáticamente de partidas pendientes
app.listen(PORT, async () => {
  await ensureMemoryFile();
  console.log(`Servidor en http://localhost:${PORT}`);

  try {
    const files = await fs.readdir(GAMES_DIR);
    const pending = files.filter(f => f.endsWith('.json') && !f.includes('processed'));
    if (pending.length > 0) {
      console.log(`📚 ${pending.length} pending games, learning...`);
      await fetch(`http://localhost:${PORT}/api/learnFromGames`, { method: 'POST' });
    }
  } catch {}
});