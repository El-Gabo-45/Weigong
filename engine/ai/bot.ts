// Bot - TypeScript
import { dbg } from '../debug/debug.ts';
import { SIDE } from '../constants.ts';
import { getAllLegalMoves } from '../rules/index.ts';
import { cloneState } from '../rules/board.ts';
import { fastCloneState } from './packed-state.ts';
import { search, searchRoot, allocateTime, moveKey, decayHistoryTable, GameDanceTracker } from './search.ts';
import { computeFullHash, TranspositionTable } from './hashing.ts';
import { SharedTT } from './shared-tt.ts';
import { evaluate } from './evaluation.ts';
import { adaptiveMemory } from './memory.ts';
import type { GameState, NormalizedMove, BotOptions, SearchResult } from '../types.ts';

const MATE_SCORE = 1_000_000;
const TT_MAX_ENTRIES = 500_000;

let _sharedTTBuffer: ArrayBuffer | null = null;

function _makeSharedTT(buffer: ArrayBuffer | null = null): SharedTT | null {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return null;
    if (buffer) _sharedTTBuffer = buffer;
    if (!_sharedTTBuffer) {
      const dummy = new SharedTT(TT_MAX_ENTRIES);
      _sharedTTBuffer = dummy.buffer;
    }
    return new SharedTT(TT_MAX_ENTRIES, _sharedTTBuffer);
  } catch { return null; }
}

function _makeTT(sharedBuffer: ArrayBuffer | null = null): TranspositionTable | SharedTT {
  const sharedTT = _makeSharedTT(sharedBuffer);
  if (sharedTT) {
    dbg.ai('Using SharedArrayBuffer TT', { entries: TT_MAX_ENTRIES });
    return sharedTT;
  }
  dbg.ai('Using Map-based TT (no SAB available)');
  return new TranspositionTable(TT_MAX_ENTRIES);
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function chooseBlackBotMove(state: GameState, options: BotOptions = {}): SearchResult {
  const maxDepth         = options.maxDepth        ?? 8;
  const timeLimitMs      = options.timeLimitMs     ?? 500;
  const aspirationWindow = options.aspirationWindow ?? 45;
  const rootNNByMoveKey  = options.rootNNByMoveKey  ?? null;
  const danceTracker     = options.danceTracker     ?? null;
  const sharedTTBuffer   = options._sharedTTBuffer  ?? null;

  let searchState: GameState;
  try { searchState = fastCloneState(state); }
  catch { searchState = cloneState(state); }

  let best: NormalizedMove | null = null, prevScore = 0;
  try {
    const fallbackMoves = getAllLegalMoves(searchState, searchState.turn as any);
    if (fallbackMoves.length > 0) {
      const fm = fallbackMoves[0];
      best = fm.fromReserve
        ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { ...fm.to }, promotion: false }
        : { from: { ...fm.from }, to: { ...fm.to }, promotion: false };
    }
  } catch {}

  const startTime = now();
  const deadline  = startTime + timeLimitMs;
  const tt = _makeTT(sharedTTBuffer);
  const rootHash = computeFullHash(searchState);
  try { const e = evaluate(searchState, rootHash); prevScore = e.score; } catch { prevScore = 0; }

  let remainingDepth = maxDepth;
  for (let depth = 1; depth <= remainingDepth; depth++) {
    if (now() > deadline) break;
    decayHistoryTable();
    const allocated = allocateTime(startTime, timeLimitMs, 40 - depth);
    const localDeadline = Math.min(deadline, startTime + allocated + (now() - startTime));
    let alpha = prevScore - aspirationWindow;
    let beta  = prevScore + aspirationWindow;
    while (true) {
      if (now() > deadline) break;
      try {
        const result = searchRoot(searchState, depth, alpha, beta, localDeadline, tt as any, rootHash, prevScore, rootNNByMoveKey as any, danceTracker);
        if (result.bestMove) { best = result.bestMove; prevScore = result.score; }
        if (Math.abs(result.score) > MATE_SCORE - 50) remainingDepth = depth;
        if (result.score <= alpha) { alpha = -Infinity; continue; }
        if (result.score >= beta)  { beta  =  Infinity; continue; }
        break;
      } catch { if (best) break; break; }
    }
    if (depth % 2 === 0 || depth === remainingDepth || depth === 1) {
      dbg.ai(`IDS depth=${depth}`, {
        best: best ? moveKey(best as any, false) : 'null', score: prevScore,
        elapsed: (now() - startTime).toFixed(0) + 'ms',
        ttSize: (tt as any).map?.size ?? (tt as any).approximateSize?.() ?? '?',
      });
    }
    if (now() > deadline) break;
  }

  if (!best) {
    try {
      const fallbackMoves = getAllLegalMoves(searchState, searchState.turn as any);
      if (fallbackMoves.length > 0) {
        const fm = fallbackMoves[0];
        best = fm.fromReserve
          ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { ...fm.to }, promotion: false }
          : { from: { ...fm.from }, to: { ...fm.to }, promotion: false };
      }
    } catch {}
  }

  if (best && !best.fromReserve && best.from && best.to) {
    try {
      const piece = state.board?.[best.from.r]?.[best.from.c];
      if (piece && danceTracker) danceTracker.record(state.turn, piece, best.from.r, best.from.c, best.to.r, best.to.c);
    } catch {}
  }
  return { move: best, score: prevScore } as any;
}

export function chooseBotMove(state: GameState, options: BotOptions = {}): SearchResult {
  return chooseBlackBotMove(state, options);
}

const MEMORY_URL = (typeof window !== 'undefined')
  ? '/api/memory'
  : `http://localhost:${process.env.PORT || 3000}/api/memory`;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function queueAdaptiveMemorySave(): void {
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

export async function loadAdaptiveMemory(): Promise<boolean> {
  try {
    const res = await fetch(MEMORY_URL);
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || data._version !== 4) { console.log(`[Memory] Version mismatch — starting fresh`); return false; }
    adaptiveMemory.fromJSON(data);
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