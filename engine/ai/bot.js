import { dbg } from '../debug/debug.js';
import { SIDE } from '../constants.js';
import { getAllLegalMoves } from '../rules/index.js';
import { cloneState } from '../rules/board.js';
import { fastCloneState } from '../ai/packed-state.js';
import { search, searchRoot, allocateTime, moveKey, decayHistoryTable, GameDanceTracker } from './search.js';
import { computeFullHash, TranspositionTable } from './hashing.js';
import { SharedTT, TT_EXACT, TT_ALPHA, TT_BETA } from './shared-tt.js';
import { evaluate } from './evaluation.js';
import { adaptiveMemory } from './memory.js';

const MATE_SCORE = 1_000_000;

// ── Per-game dance tracker ────────────────────────────────────────────────────
// One tracker instance lives here and is reset when a new game starts.
// It records every real move played and passes the data to searchRoot so
// the engine can penalise oscillating pieces across turns.
// ES: Tracker de baile por partida — persiste entre turnos y se pasa a searchRoot.
let _gameDanceTracker = new GameDanceTracker();

/** Call this at game start/reset to clear the dance history. */
export function resetDanceTracker() { _gameDanceTracker.reset(); }
// ─────────────────────────────────────────────────────────────────────────────

// ── Detect environment ────────────────────────────────────────────────────────
const IS_NODE   = typeof process !== 'undefined' && process.versions?.node;
const IS_WORKER = IS_NODE && typeof workerData !== 'undefined';  // inside worker_threads worker

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// ── SharedArrayBuffer TT ─────────────────────────────────────────────────────
// We use SharedTT (SharedArrayBuffer-backed) when available so that parallel
// workers share a single TT and benefit from each other's search results.
// Falls back to the Map-based TranspositionTable in environments without SAB
// (e.g. browsers without cross-origin isolation, or when explicitly disabled).
//
// ES: Usamos SharedTT (respaldado por SharedArrayBuffer) cuando está disponible
// para que los workers paralelos compartan una sola TT. Recae en TranspositionTable
// basada en Map en entornos sin SAB.

const TT_MAX_ENTRIES = 500_000;

let _sharedTTBuffer = null;  // SharedArrayBuffer reused across turns

function _makeSharedTT() {
  // SharedArrayBuffer requires cross-origin isolation in browsers.
  // In Node.js it is always available.
  // ES: SharedArrayBuffer requiere aislamiento cross-origin en navegadores.
  // En Node.js siempre está disponible.
  try {
    if (typeof SharedArrayBuffer === 'undefined') return null;
    if (!_sharedTTBuffer) {
      const dummy = new SharedTT(TT_MAX_ENTRIES);
      _sharedTTBuffer = dummy.buffer;
    }
    // Reuse buffer across turns — entries from previous turn improve move ordering.
    // Depth-preferred replacement means stale entries get overwritten naturally.
    // ES: Reutilizar buffer entre turnos — las entradas del turno anterior mejoran
    // el ordenamiento. El reemplazo preferente por profundidad sobreescribe entradas viejas.
    return new SharedTT(TT_MAX_ENTRIES, _sharedTTBuffer);
  } catch {
    return null;
  }
}

function _makeTT() {
  const sharedTT = _makeSharedTT();
  if (sharedTT) {
    dbg.ai('Using SharedArrayBuffer TT', { entries: TT_MAX_ENTRIES });
    return sharedTT;
  }
  dbg.ai('Using Map-based TT (no SAB available)');
  return new TranspositionTable(TT_MAX_ENTRIES);
}

// ── Parallel root search ─────────────────────────────────────────────────────
// Splits root moves across N worker threads. Each worker searches its subset,
// and we merge by taking the highest-scoring result.
//
// Architecture:
//   - Worker is a self-contained module (bot-worker.js, created inline via Blob
//     or required as a file in Node).
//   - Workers receive: packed state (Uint8Array), move subset, TT SharedArrayBuffer,
//     depth, alpha, beta, deadline.
//   - They respond with: { bestMove, score } for their subset.
//   - Main thread merges all responses.
//
// When workers are unavailable (browser without module workers, test env),
// falls back to single-threaded searchRoot.
//
// ES: Divide los movimientos raíz entre N workers. Cada worker busca su subconjunto
// y el hilo principal fusiona tomando el resultado de mayor score.

const NUM_WORKERS = (() => {
  // Use 2 workers in Node (typically has multiple CPUs available for the server).
  // In browser use 0 (single-threaded) — browser workers add overhead that isn't
  // worth it for time limits < 2000ms, and SharedArrayBuffer availability is uncertain.
  // ES: 2 workers en Node (servidor con múltiples CPUs). 0 en browser — el overhead
  // no compensa para límites de tiempo < 2000ms.
  if (!IS_NODE) return 0;
  try {
    // Only use workers if worker_threads is available (Node >= 12)
    // ES: Solo usar workers si worker_threads está disponible (Node >= 12)
    require('worker_threads');
    return 2;
  } catch {
    return 0;
  }
})();

// Inline worker source — avoids needing a separate file on disk.
// The worker imports from the same module graph using workerData.basePath.
// ES: Código fuente del worker inline — evita necesitar un archivo separado en disco.
const WORKER_SOURCE = `
import { workerData, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const { packedState, moves, ttBuffer, depth, alpha, beta, deadlineMs, prevScore } = workerData;

// Dynamic import of search from the same location as bot.js
// ES: Import dinámico de search desde la misma ubicación que bot.js
const basePath = workerData.basePath;
const { search, moveKey } = await import(basePath + '/search.js');
const { SharedTT } = await import(basePath + '/shared-tt.js');
const { fastCloneState, PackedBoard } = await import(basePath + '/../ai/packed-state.js');
const { computeFullHash } = await import(basePath + '/hashing.js');
const { makeMove, unmakeMove } = await import(basePath + '/moves.js');

const tt = ttBuffer ? new SharedTT(500_000, ttBuffer) : null;

// Unpack state
const packed = new PackedBoard();
packed.fromFlat(new Uint8Array(packedState));
const state = packed.toLightState();
// Note: history is not in packed format — pass it separately
state.history = workerData.history ?? [];

const hash = computeFullHash(state);
const deadline = deadlineMs;
const maximizing = state.turn === 'black';

let bestMove = null, bestScore = maximizing ? -1e9 : 1e9;

for (const move of moves) {
  try {
    const md = makeMove(state, move, move.promotion ?? false, hash, prevScore);
    if (!md.action || !md.undo) continue;
    try {
      let score;
      if (bestMove === null) {
        score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, null, false);
      } else {
        score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, null, false);
        if (score > alpha && score < beta)
          score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, null, false);
      }
      if (maximizing ? score > bestScore : score < bestScore) {
        bestScore = score;
        bestMove = md.action;
      }
      if (maximizing) alpha = Math.max(alpha, bestScore);
      else            beta  = Math.min(beta,  bestScore);
      if (alpha >= beta) break;
    } finally {
      unmakeMove(state, md);
    }
  } catch {}
}

parentPort.postMessage({ bestMove, score: bestScore });
`;

/**
 * Run parallel root search across NUM_WORKERS threads.
 * Returns { bestMove, score }.
 * On any failure (worker crash, timeout) returns null → caller falls back to single-threaded.
 * ES: Búsqueda paralela en la raíz sobre NUM_WORKERS threads.
 * Retorna null en caso de fallo → el llamador cae en modo monohilo.
 */
async function parallelSearchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore, moves, basePath) {
  if (NUM_WORKERS < 2 || moves.length < 4) return null;
  try {
    const { Worker } = await import('worker_threads');
    const { PackedBoard } = await import('./packed-state.js');

    // Pack state for transfer (avoids structured clone of 169-object board)
    // ES: Empaquetar estado para transferencia (evita clon estructurado de 169 objetos)
    const packedFlat = PackedBoard.pack(state);
    const sharedTTBuffer = tt instanceof SharedTT ? tt.buffer : null;

    // Split moves round-robin across workers
    // ES: Dividir movimientos round-robin entre workers
    const chunks = Array.from({ length: NUM_WORKERS }, () => []);
    for (let i = 0; i < moves.length; i++) chunks[i % NUM_WORKERS].push(moves[i]);

    const deadlineMs = deadline;
    const workerPromises = chunks.map((moveChunk, wi) => {
      if (moveChunk.length === 0) return Promise.resolve(null);
      return new Promise((resolve) => {
        let resolved = false;
        const resolve1 = (v) => { if (!resolved) { resolved = true; resolve(v); } };
        try {
          const w = new Worker(
            `data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`,
            {
              eval: true,
              workerData: {
                packedState: packedFlat.buffer,
                moves: moveChunk,
                ttBuffer: sharedTTBuffer,
                depth, alpha, beta, deadlineMs, prevScore,
                basePath,
                history: state.history ? [...state.history] : [],
              },
              transferList: sharedTTBuffer ? [] : [],
            }
          );
          w.once('message', (msg) => { w.terminate(); resolve1(msg); });
          w.once('error',   ()    => { w.terminate(); resolve1(null); });
          // Hard timeout: if worker doesn't finish by deadline + 50ms, kill it
          // ES: Timeout duro: si el worker no termina antes del deadline + 50ms, matarlo
          setTimeout(() => { w.terminate(); resolve1(null); }, Math.max(50, deadline - now() + 50));
        } catch { resolve1(null); }
      });
    });

    const results = await Promise.all(workerPromises);
    const maximizing = state.turn === SIDE.BLACK;
    let bestMove = null, bestScore = maximizing ? -MATE_SCORE * 2 : MATE_SCORE * 2;
    for (const r of results) {
      if (!r) continue;
      if (maximizing ? r.score > bestScore : r.score < bestScore) {
        bestScore = r.score;
        bestMove  = r.bestMove;
      }
    }
    return bestMove ? { bestMove, score: bestScore } : null;
  } catch {
    return null;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function chooseBlackBotMove(state, options = {}) {
  const maxDepth        = options.maxDepth        ?? 8;
  const timeLimitMs     = options.timeLimitMs     ?? 500;
  const aspirationWindow = options.aspirationWindow ?? 45;
  const rootNNByMoveKey = options.rootNNByMoveKey ?? null;
  // Use caller-supplied danceTracker (server.js, selfplay.js) if provided,
  // otherwise use the module-level one (direct bot.js usage).
  // ES: Usar tracker externo si lo pasa el llamador, si no el interno del módulo.
  const danceTracker = options.danceTracker ?? _gameDanceTracker;

  // PACKED: use fastCloneState (PackedBoard intermediate) instead of cloneState.
  // Saves ~40% clone time on 169-cell board (no dynamic property enumeration).
  // ES: fastCloneState usa PackedBoard como intermediario — ~40% más rápido que cloneState.
  let searchState;
  try {
    searchState = fastCloneState(state);
  } catch {
    searchState = cloneState(state);  // fallback
  }

  let best = null, prevScore = 0;
  try {
    const fallbackMoves = getAllLegalMoves(searchState, searchState.turn);
    if (fallbackMoves.length > 0) {
      const fm = fallbackMoves[0];
      best = fm.fromReserve
        ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { ...fm.to }, promotion: false }
        : { from: { ...fm.from }, to: { ...fm.to }, promotion: false };
    }
  } catch {}

  const startTime = now();
  const deadline  = startTime + timeLimitMs;

  // SHARED-TT: reuse SharedArrayBuffer across turns for better move ordering
  // ES: Reutilizar SharedArrayBuffer entre turnos para mejor ordenamiento
  const tt = _makeTT();

  const rootHash = computeFullHash(searchState);
  try { prevScore = evaluate(searchState, rootHash).score; } catch { prevScore = 0; }

  let remainingDepth = maxDepth;

  for (let depth = 1; depth <= remainingDepth; depth++) {
    if (now() > deadline) break;

    // Decay history table so shallow-depth scores don't dominate deeper iterations
    // ES: Decay de tabla de historia para que scores de poca profundidad no dominen
    decayHistoryTable();

    const allocated    = allocateTime(startTime, timeLimitMs, 40 - depth);
    const localDeadline = Math.min(deadline, startTime + allocated + (now() - startTime));

    let alpha = prevScore - aspirationWindow;
    let beta  = prevScore + aspirationWindow;

    while (true) {
      if (now() > deadline) break;
      try {
        const result = searchRoot(searchState, depth, alpha, beta, localDeadline, tt, rootHash, prevScore, rootNNByMoveKey, danceTracker);
        if (result.bestMove) { best = result.bestMove; prevScore = result.score; }
        if (Math.abs(result.score) > MATE_SCORE - 50) remainingDepth = depth;
        if (result.score <= alpha) {
          dbg.ai.warn(`aspiration fail-low`,  { alpha, score: result.score, depth, best: best ? moveKey(best, false) : 'null' });
          alpha = -Infinity; continue;
        }
        if (result.score >= beta) {
          dbg.ai.warn(`aspiration fail-high`, { beta,  score: result.score, depth, best: best ? moveKey(best, false) : 'null' });
          beta  =  Infinity; continue;
        }
        break;
      } catch (err) {
        if (best) break;
        console.error('[chooseBlackBotMove] Error en depth', depth, ':', err);
        break;
      }
    }

    if (depth % 2 === 0 || depth === remainingDepth || depth === 1) {
      dbg.ai(`IDS depth=${depth}`, {
        best:    best ? moveKey(best, false) : 'null',
        score:   prevScore,
        elapsed: (now() - startTime).toFixed(0) + 'ms',
        ttSize:  tt.map?.size ?? tt.approximateSize?.() ?? '?',
        ttType:  tt instanceof SharedTT ? 'SharedTT' : 'MapTT',
      });
    }
    if (now() > deadline) break;
  }

  if (!best) {
    try {
      const fallbackMoves = getAllLegalMoves(searchState, searchState.turn);
      if (fallbackMoves.length > 0) {
        const fm = fallbackMoves[0];
        best = fm.fromReserve
          ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { ...fm.to }, promotion: false }
          : { from: { ...fm.from }, to: { ...fm.to }, promotion: false };
      }
    } catch (err) { console.error('[chooseBlackBotMove] Error obteniendo fallback:', err); }
  }

  // Record the chosen move in the per-game dance tracker so future turns
  // penalise pieces that oscillate back to the same squares.
  // ES: Registrar movimiento elegido en el tracker de baile por partida.
  if (best && !best.fromReserve && best.from && best.to) {
    try {
      const piece = state.board?.[best.from.r]?.[best.from.c];
      if (piece) danceTracker.record(state.turn, piece, best.from.r, best.from.c, best.to.r, best.to.c);
    } catch {}
  }

  return { move: best, score: prevScore };
}

export function chooseBotMove(state, options = {}) { return chooseBlackBotMove(state, options); }

// ── Adaptive memory persistence ───────────────────────────────────────────────

const MEMORY_URL = (typeof window !== 'undefined')
  ? '/api/memory'
  : `http://localhost:${process.env.PORT || 3000}/api/memory`;

let saveTimer = null;

export function queueAdaptiveMemorySave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(MEMORY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adaptiveMemory.toJSON()),
      });
    } catch {}
  }, 500);
}

export async function loadAdaptiveMemory() {
  try {
    const res = await fetch(MEMORY_URL);
    if (!res.ok) return false;
    adaptiveMemory.fromJSON(await res.json());
    return true;
  } catch { return false; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(MEMORY_URL,
          new Blob([JSON.stringify(adaptiveMemory.toJSON())], { type: 'application/json' }));
      } catch {}
    }
  });
  void loadAdaptiveMemory();
}