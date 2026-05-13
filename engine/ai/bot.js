import { dbg } from '../debug/debug.js';
import { SIDE } from '../constants.js';
import { getAllLegalMoves } from '../rules/index.js';
import { search, searchRoot, allocateTime, moveKey } from './search.js';
import { computeFullHash, TranspositionTable } from './hashing.js';
import { evaluate } from './evaluation.js';
import { adaptiveMemory } from './memory.js';

const MATE_SCORE = 1_000_000;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function chooseBlackBotMove(state, options = {}) {
  const maxDepth = options.maxDepth ?? 8, timeLimitMs = options.timeLimitMs ?? 500, aspirationWindow = options.aspirationWindow ?? 45;
  let best = null, prevScore = 0;
  try {
    const fallbackMoves = getAllLegalMoves(state, state.turn);
    if (fallbackMoves.length > 0) {
      const fm = fallbackMoves[0];
      best = fm.fromReserve ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { ...fm.to }, promotion: false } : { from: { ...fm.from }, to: { ...fm.to }, promotion: false };
    }
  } catch (e) {}
  const startTime = now(), deadline = startTime + timeLimitMs, tt = new TranspositionTable(500_000), rootHash = computeFullHash(state);
  try { prevScore = evaluate(state, rootHash).score; } catch (e) { prevScore = 0; }
  let remainingDepth = maxDepth;
  for (let depth = 1; depth <= remainingDepth; depth++) {
    if (now() > deadline) break;
    const allocated = allocateTime(startTime, timeLimitMs, 40 - depth);
    const localDeadline = Math.min(deadline, startTime + allocated + (now() - startTime));
    let alpha = prevScore - aspirationWindow, beta = prevScore + aspirationWindow;
    while (true) {
      if (now() > deadline) break;
      try {
        const result = searchRoot(state, depth, alpha, beta, localDeadline, tt, rootHash, prevScore);
        if (result.bestMove) { best = result.bestMove; prevScore = result.score; }
        if (Math.abs(result.score) > MATE_SCORE - 50) remainingDepth = depth;
        if (result.score <= alpha) {
          dbg.ai.warn(`aspiration fail-low`, { alpha, score: result.score, depth, best: best ? moveKey(best, false) : 'null' });
          alpha = -Infinity; continue;
        }
        if (result.score >= beta) {
          dbg.ai.warn(`aspiration fail-high`, { beta, score: result.score, depth, best: best ? moveKey(best, false) : 'null' });
          beta  =  Infinity; continue;
        }
        break;
      } catch (err) { 
        // SearchTimeout: just use best from previous depth
        if (best) break;
        console.error('[chooseBlackBotMove] Error en depth', depth, ':', err);
        break;
      }
    }
    // Log IDS progress at each depth (or at least every other depth)
    if (depth % 2 === 0 || depth === remainingDepth || depth === 1) {
      dbg.ai(`IDS depth=${depth}`, {
        best: best ? moveKey(best, false) : 'null',
        score: prevScore,
        elapsed: (now() - startTime).toFixed(0) + 'ms',
        ttSize: tt.map.size,
      });
    }
    if (now() > deadline) break;
  }
  if (!best) {
    try {
      const fallbackMoves = getAllLegalMoves(state, state.turn);
      if (fallbackMoves.length > 0) {
        const fm = fallbackMoves[0];
        best = fm.fromReserve ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { ...fm.to }, promotion: false } : { from: { ...fm.from }, to: { ...fm.to }, promotion: false };
      }
    } catch (err) { console.error('[chooseBlackBotMove] Error obteniendo fallback:', err); }
  }
  return { move: best, score: prevScore };
}

export function chooseBotMove(state, options = {}) { return chooseBlackBotMove(state, options); }

const MEMORY_URL = (typeof window !== 'undefined')
  ? '/api/memory'
  : `http://localhost:${process.env.PORT || 3000}/api/memory`;

let saveTimer = null;

export function queueAdaptiveMemorySave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await fetch(MEMORY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adaptiveMemory.toJSON()) }); } catch {}
  }, 500);
}

export async function loadAdaptiveMemory() {
  try { const res = await fetch(MEMORY_URL); if (!res.ok) return false; adaptiveMemory.fromJSON(await res.json()); return true; } catch { return false; }
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