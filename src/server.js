// server.js
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'worker_threads';
import { SIDE } from './constants.js';
import { trainFromGames, getModelInfo } from './nn-bridge.js';
import pako from 'pako';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const MEMORY_FILE = path.join(__dirname, 'data', 'ai-memory.json');
const GAMES_DIR   = path.join(__dirname, '..', 'games');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..')));

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
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      let jsonString;
      try {
        jsonString = pako.ungzip(buffer, { to: 'string' });
      } catch {
        return res.status(400).json({ error: 'Data corrupted (invalid gzip)' });
      }
      const game = JSON.parse(jsonString);
      if (!game.moves || !game.finalStatus) {
        return res.status(400).json({ error: 'There are missing data (moves, finalStatus)' });
      }
      await fs.mkdir(GAMES_DIR, { recursive: true });
      const name = `game_${Date.now()}_${Math.random().toString(36).slice(2,8)}.json`;
      await fs.writeFile(path.join(GAMES_DIR, name), JSON.stringify(game, null, 2), 'utf8');
      console.log(`✔ Partida guardada: ${name} (${(buffer.length/1024).toFixed(1)} KB subidos)`);
      res.json({ ok: true, file: name });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar' });
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

          // Mapa de Turn -> nn encoding
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