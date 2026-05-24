import { dbg } from '../debug/debug.js';
import { SIDE, opponent, isPalaceSquare, onBank, isPromotableType } from '../constants.js';
import { getAllLegalMoves, isKingInCheck, isPromotionAvailableForMove, isSquareAttacked } from '../rules/index.js';
import { computeFullHash, TranspositionTable, ZobristTurn } from './hashing.js';
import { evaluate, gamePhaseFactor, buildAttackMap } from './evaluation.js';
import { makeMove, unmakeMove, isSEEPositive, pieceValue } from './moves.js';
import { adaptiveMemory } from './memory.js';
import { createIncrementalMaps, applyMoveToMaps } from './incremental-attack.js';

const MATE_SCORE = 1_000_000;
const INF        = 1_000_000_000;
const TT_EXACT = 0, TT_ALPHA = 1, TT_BETA = 2;
const FUTILITY_MARGIN = [0, 150, 300, 500];

const DRAW_CONTEMPT    = 180;   // increased from 120: stronger contempt for draw lines
const QSEARCH_MAX_DEPTH = 6;
const QDELTA_MARGIN     = 600;

const killerMoves  = new Map();
const historyTable = { white: new Map(), black: new Map() };
const KILLER_SLOTS = 2;

// ── Piece-Activity Tracker (anti-dance / anti-shuffle) ────────────────────────
// Penalises pieces that oscillate between squares without making positional
// progress, even if the exact same position isn't repeated.
//
// Design: the CALLER (server.js / bot.js) builds a GameDanceTracker per game
// and passes it as `danceTracker` in the options to chooseBlackBotMove / searchRoot.
// The tracker holds real game history (not search tree history), so it persists
// across turns.  Inside moveOrderScore, we look up the candidate move's destination
// in the tracker to compute oscillation and stagnation penalties.
//
// Penalty schedule (quiet non-king non-capture moves only):
//   oscillationPenalty : +80 per previous visit to the target square, cap 480
//   stagnationPenalty  : +100 if piece centroid hasn't advanced ≥1 row, +100 more
//                        if this specific move also doesn't advance
//
// ES: El LLAMADOR construye un GameDanceTracker por partida y lo pasa como
// `danceTracker` en las opciones.  El tracker persiste entre turnos y penaliza
// piezas que oscilan sin avanzar.

const PAT_BASE_PEN  = 80;   // penalty per visit to the same target square
const PAT_MAX_PEN   = 480;  // cap on oscillation penalty
const PAT_STAG_PEN  = 100;  // base stagnation penalty
const PAT_ADV_THRESHOLD = 1; // min row advance before stagnation penalty fires

/**
 * GameDanceTracker — one instance per game, passed from caller to search.
 *
 * Usage:
 *   const dt = new GameDanceTracker();
 *   // after each real played move:
 *   dt.record(side, piece, fromR, fromC, toR, toC);
 *   // pass to bot:
 *   chooseBlackBotMove(state, { ..., danceTracker: dt });
 *
 * ES: Una instancia por partida, creada por server.js/selfplay.js y pasada al motor.
 */
export class GameDanceTracker {
  constructor(windowSize = 30) {
    this.windowSize = windowSize;
    // visitCounts[side][cellIdx] = { [pieceType@fromSquare]: count }
    // Stored as: Map<side, Map<pieceKey, Map<cellIdx, count>>>
    this.visits    = { white: new Map(), black: new Map() };
    this.centroids = { white: new Map(), black: new Map() }; // pieceKey → {sumRow, count}
    this.ring      = { white: [], black: [] }; // FIFO of {key, cellIdx, toRow}
  }

  /** Record a real game move (not a search move). */
  record(side, piece, fr, fc, tr, tc) {
    if (!piece || piece.type === 'king') return;
    const key     = `${piece.type}@${fr},${fc}`;
    const cellIdx = tr * 13 + tc;
    const sv      = this.visits[side];
    const sc      = this.centroids[side];
    const ring    = this.ring[side];

    // Visit map
    let pm = sv.get(key);
    if (!pm) { pm = new Map(); sv.set(key, pm); }
    pm.set(cellIdx, (pm.get(cellIdx) ?? 0) + 1);

    // Centroid
    let ce = sc.get(key);
    if (!ce) { ce = { sumRow: 0, count: 0 }; sc.set(key, ce); }
    ce.sumRow += tr;
    ce.count++;

    // Ring buffer eviction
    if (ring.length >= this.windowSize) {
      const evicted = ring.shift();
      const epm = sv.get(evicted.key);
      if (epm) {
        const prev = epm.get(evicted.cellIdx) ?? 0;
        if (prev <= 1) epm.delete(evicted.cellIdx);
        else           epm.set(evicted.cellIdx, prev - 1);
        if (epm.size === 0) sv.delete(evicted.key);
      }
      const ece = sc.get(evicted.key);
      if (ece) {
        ece.sumRow -= evicted.toRow;
        ece.count   = Math.max(0, ece.count - 1);
        if (ece.count === 0) sc.delete(evicted.key);
      }
    }
    ring.push({ key, cellIdx, toRow: tr });
  }

  /** Oscillation penalty for moving `piece` from (fr,fc) to (tr,tc). */
  oscillation(side, piece, fr, fc, tr, tc) {
    if (!piece || piece.type === 'king') return 0;
    const key  = `${piece.type}@${fr},${fc}`;
    const pm   = this.visits[side]?.get(key);
    if (!pm) return 0;
    const visits = pm.get(tr * 13 + tc) ?? 0;
    if (visits < 1) return 0;
    return Math.min(PAT_MAX_PEN, visits * PAT_BASE_PEN);
  }

  /** Stagnation penalty: fires when a piece hasn't advanced its centroid. */
  stagnation(side, piece, fr, fc, tr, tc) {
    if (!piece || piece.type === 'king') return 0;
    const key = `${piece.type}@${fr},${fc}`;
    const ce  = this.centroids[side]?.get(key);
    if (!ce || ce.count < 3) return 0;
    const avgRow  = ce.sumRow / ce.count;
    // BLACK advances toward row 0 (lower rows), WHITE toward row 12
    const advance = side === SIDE.BLACK ? fr - avgRow : avgRow - fr;
    if (advance >= PAT_ADV_THRESHOLD) return 0;
    const thisMoveAdv = side === SIDE.BLACK ? fr - tr : tr - fr;
    return PAT_STAG_PEN + (thisMoveAdv <= 0 ? PAT_STAG_PEN : 0);
  }

  /** Reset (call at game start or after a capture resets piece identity). */
  reset() {
    this.visits    = { white: new Map(), black: new Map() };
    this.centroids = { white: new Map(), black: new Map() };
    this.ring      = { white: [], black: [] };
  }
}

// Module-level active tracker — set by searchRoot when caller passes one.
// ES: Tracker activo a nivel de módulo — fijado por searchRoot cuando el llamador lo pasa.
let _activeDanceTracker = null;

/**
 * Oscillation penalty using the active tracker (called from moveOrderScore).
 * Returns 0 if no tracker is set.
 */
function oscillationPenalty(side, piece, fr, fc, tr, tc) {
  return _activeDanceTracker?.oscillation(side, piece, fr, fc, tr, tc) ?? 0;
}

/**
 * Stagnation penalty using the active tracker (called from moveOrderScore).
 */
function stagnationPenalty(side, piece, fr, fc, tr, tc) {
  return _activeDanceTracker?.stagnation(side, piece, fr, fc, tr, tc) ?? 0;
}
// ─────────────────────────────────────────────────────────────────────────────

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

class SearchTimeout extends Error {}

const DROP_MOVE_FLAG = 1 << 31;

export function moveKey(move, promote = false) {
  if (!move) return 'null';
  if (move.fromReserve) return `R:${move.reserveIndex}->${move.to.r},${move.to.c}`;
  const promotionFlag = promote ? ':p1' : ':p0';
  return `M:${move.from.r},${move.from.c}->${move.to.r},${move.to.c}${promotionFlag}`;
}

export function moveKeyUint32(move, promote = false) {
  if (!move) return 0;
  if (move.fromReserve) {
    const reserveIndex = Number.isInteger(move.reserveIndex) ? move.reserveIndex & 0xF : 0;
    const r = move.to?.r ?? 0;
    const c = move.to?.c ?? 0;
    return (((DROP_MOVE_FLAG >>> 0) | ((reserveIndex & 0xF) << 24) | ((r & 0xF) << 20) | ((c & 0xF) << 16)) >>> 0);
  }
  const fr = move.from?.r ?? 0;
  const fc = move.from?.c ?? 0;
  const tr = move.to?.r ?? 0;
  const tc = move.to?.c ?? 0;
  const p  = promote ? 1 : 0;
  return (((fr & 0xF) << 28) | ((fc & 0xF) << 24) | ((tr & 0xF) << 20) | ((tc & 0xF) << 16) | ((p & 1) << 15)) >>> 0;
}

function storeKiller(depth, move) {
  const key = moveKeyUint32(move, move.promotion ?? false);
  const prev = killerMoves.get(depth) ?? [];
  if (prev[0] === key) return;
  killerMoves.set(depth, [key, prev[0] ?? null].filter(Boolean).slice(0, KILLER_SLOTS));
}

function killerScore(depth, mk) {
  const arr = killerMoves.get(depth);
  if (!arr) return 0;
  return arr[0] === mk ? 900 : arr[1] === mk ? 650 : 0;
}

function historyScore(side, mk) { return historyTable[side].get(mk) ?? 0; }

function storeHistory(side, move, depth) {
  const key = moveKeyUint32(move, move.promotion ?? false);
  historyTable[side].set(key, (historyTable[side].get(key) ?? 0) + depth * depth);
}

export function decayHistoryTable() {
  for (const [k, v] of historyTable.white) historyTable.white.set(k, v >> 1);
  for (const [k, v] of historyTable.black) historyTable.black.set(k, v >> 1);
}

function isQuiet(state, move, promote) {
  return !move || move.fromReserve || promote ? false : !state.board?.[move.to?.r]?.[move.to?.c];
}

function terminalScore(state, depth, precomputedMoves = null) {
  try {
    const legal = precomputedMoves ?? getAllLegalMoves(state, state.turn) ?? [];
    const inCheck = isKingInCheck(state, state.turn);
    if (legal.length === 0)
      return inCheck ? (state.turn === SIDE.BLACK ? -MATE_SCORE + depth : MATE_SCORE - depth) : 0;
    return null;
  } catch (err) {
    console.error('[terminalScore] Error:', err);
    return null;
  }
}

function isTactical(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return false;
  const moving = state.board?.[move.from.r]?.[move.from.c];
  if (!moving) return false;
  if (state.board?.[move.to.r]?.[move.to.c]) return true;
  return !moving.promoted && isPromotionAvailableForMove(state, move.from, move.to);
}

function givesCheck(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return false;
  const md = makeMove(state, move, false, 0n, null);
  if (!md.action) return false;
  const inCheck = isKingInCheck(state, state.turn);
  unmakeMove(state, md);
  return inCheck;
}

function countRepetitions(history, hash) {
  let seen = 0;
  for (const h of history) if (h === hash) seen++;
  return seen;
}

// ── INCR: Incremental attack map helpers ─────────────────────────────────────
// evaluate() accepts precomputedMaps = { black, white } where each is an
// attackMapResult from IncrementalAttackMap._wrapResult / createIncrementalMaps.
// We build them once per searchRoot call, then update incrementally per move
// using applyMoveToMaps, and rebuild (O(169)) after unmakeMove.
//
// On benchmarks this saves ~30% of evaluate() time at depth >= 6 since
// buildAttackMap was called twice (black+white) per node on every evaluate call.
// ES: Maps incrementales: se construyen una vez en searchRoot, se actualizan por
// movimiento y se reconstruyen después de unmake. Ahorra ~30% del tiempo de evaluate.

// Extract moved/captured piece from undo record for applyMoveToMaps
// ES: Extrae pieza movida/capturada del registro undo para applyMoveToMaps
function _extractMoveInfo(md, move) {
  let movedPiece = null, capturedPiece = null;
  if (md.undo && md.undo.cells) {
    for (let i = 0; i < md.undo.cellCount; i++) {
      const cell = md.undo.cells[i];
      if (!move.fromReserve && move.from && cell.r === move.from.r && cell.c === move.from.c) {
        movedPiece = cell.p;
      } else if (move.to && cell.r === move.to.r && cell.c === move.to.c) {
        capturedPiece = cell.p;
      }
    }
  }
  return { movedPiece, capturedPiece };
}

// Apply maps incrementally; on any error fall back to null (maps disabled for this node)
// ES: Actualiza mapas incrementalmente; si hay error, deshabilita los mapas para este nodo
function _applyMaps(maps, state, move, md, promote) {
  if (!maps) return null;
  try {
    const { movedPiece, capturedPiece } = _extractMoveInfo(md, move);
    applyMoveToMaps(maps, state, move, capturedPiece, movedPiece, promote);
    return maps;
  } catch {
    return null;
  }
}

// Rebuild both sides after unmakeMove — O(169) each, but cheaper than full clone
// ES: Reconstruye ambos bandos después de unmakeMove — O(169) cada uno
function _rebuildMaps(maps, board) {
  if (!maps) return;
  try {
    maps._blackInc?.rebuild(board);
    maps._whiteInc?.rebuild(board);
    // Sync the result refs so maps.black/maps.white are current
    if (maps._blackInc) maps.black = maps._blackInc.get();
    if (maps._whiteInc) maps.white = maps._whiteInc.get();
  } catch {}
}

// ── quiescence ───────────────────────────────────────────────────────────────
function quiescence(state, alpha, beta, deadline, hash, staticEval = null, qdepth = QSEARCH_MAX_DEPTH, maps = null) {
  if (now() > deadline) throw new SearchTimeout();
  const maximizing = state.turn === SIDE.BLACK;
  const inCheck    = isKingInCheck(state, state.turn);

  // INCR: pass precomputed maps to evaluate — avoids two O(169) buildAttackMap calls
  // ES: pasar mapas precomputados a evaluate — evita dos reconstrucciones O(169)
  const precomputed = maps ? { black: maps.black, white: maps.white } : null;
  const ev = staticEval ?? evaluate(state, hash, precomputed, true).score;

  if (qdepth <= 0 && !inCheck) return ev;

  let best = inCheck ? (maximizing ? -INF : INF) : ev;
  if (!inCheck) {
    if (maximizing) {
      if (best >= beta) return best;
      alpha = Math.max(alpha, best);
      if (ev + QDELTA_MARGIN < alpha) return ev;
    } else {
      if (best <= alpha) return best;
      beta = Math.min(beta, best);
      if (ev - QDELTA_MARGIN > beta) return ev;
    }
  }

  const moves = getAllLegalMoves(state, state.turn)
    .filter(m => m && (inCheck || isTactical(state, m)))
    .sort((a, b) => moveOrderScore(state, b, 0) - moveOrderScore(state, a, 0));

  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    if (!inCheck && !move.fromReserve && state.board[move.to?.r]?.[move.to?.c]) {
      if (!isSEEPositive(state, move, buildAttackMap)) continue;
    }
    for (const promote of getBranches(state, move)) {
      const md = makeMove(state, move, promote, hash, best);
      if (!md.action || !md.undo) continue;
      const childMaps = _applyMaps(maps, state, move, md, promote);
      try {
        const score = -quiescence(state, -beta, -alpha, deadline, md.hash,
          md.evalDiff ? -best - md.evalDiff : null, qdepth - 1,
          childMaps ? { black: maps.black, white: maps.white, _blackInc: maps._blackInc, _whiteInc: maps._whiteInc } : null);
        if (maximizing) {
          if (score > best) best = score;
          alpha = Math.max(alpha, best);
          if (alpha >= beta) return best;
        } else {
          if (score < best) best = score;
          beta = Math.min(beta, best);
          if (alpha >= beta) return best;
        }
      } finally {
        unmakeMove(state, md);
        if (childMaps) _rebuildMaps(maps, state.board);
      }
    }
  }
  return best;
}

// ── search ───────────────────────────────────────────────────────────────────
export function search(state, depth, alpha, beta, deadline, tt, hash,
                       staticEval = null, isNullMove = false, maps = null) {
  if (now() > deadline) throw new SearchTimeout();

  // Repetition detection
  if (state.history?.length >= 2) {
    const reps = countRepetitions(state.history, hash);
    const priorReps = Math.max(0, reps - 1);
    if (priorReps >= 2) {
      const contempt = state.turn === SIDE.BLACK ? -DRAW_CONTEMPT : DRAW_CONTEMPT;
      dbg.search(`repetition draw`, { hash: hash.toString().slice(0, 10), reps, priorReps });
      return contempt;
    }
    if (priorReps === 1) {
      // INCR: use precomputed maps for this evaluate call too
      // ES: usar mapas precomputados para este evaluate también
      const precomputed = maps ? { black: maps.black, white: maps.white } : null;
      if (staticEval === null) staticEval = evaluate(state, hash, precomputed, true).score;
      const sign = state.turn === SIDE.BLACK ? 1 : -1;
      staticEval -= sign * (250 + depth * 35);
    }
  }

  const cached = tt.get(hash);
  if (cached && cached.depth >= depth) {
    dbg.search(`TT hit`, {
      flag:  cached.flag === TT_EXACT ? 'EXACT' : cached.flag === TT_ALPHA ? 'ALPHA' : 'BETA',
      score: cached.score, depth,
      hash:  hash.toString().slice(0, 12),
    });
    if (cached.flag === TT_EXACT) return cached.score;
    if (cached.flag === TT_ALPHA && cached.score <= alpha) return alpha;
    if (cached.flag === TT_BETA  && cached.score >= beta)  return beta;
  }

  const rawMoves = getAllLegalMoves(state, state.turn);
  const term = terminalScore(state, depth, rawMoves);
  if (term !== null) return term;
  if (depth <= 0) return quiescence(state, alpha, beta, deadline, hash, staticEval, QSEARCH_MAX_DEPTH, maps);

  const maximizing = state.turn === SIDE.BLACK;
  const inCheck    = isKingInCheck(state, state.turn);

  // INCR: use precomputed maps for static eval — avoids O(169)×2 buildAttackMap
  // ES: usar mapas precomputados para eval estática — evita O(169)×2 buildAttackMap
  const precomputed = maps ? { black: maps.black, white: maps.white } : null;
  if (staticEval === null) staticEval = evaluate(state, hash, precomputed, true).score;

  // Razoring
  if (!inCheck && depth <= 2) {
    const razorMargin = depth === 1 ? 250 : 450;
    if (maximizing && staticEval + razorMargin <= alpha)
      return quiescence(state, alpha, beta, deadline, hash, staticEval, QSEARCH_MAX_DEPTH, maps);
    if (!maximizing && staticEval - razorMargin >= beta)
      return quiescence(state, alpha, beta, deadline, hash, staticEval, QSEARCH_MAX_DEPTH, maps);
  }

  const hasDrops    = state.reserves[state.turn].length > 0;
  const curseActive = state.palaceCurse?.[state.turn]?.active;

  // Null move pruning with adaptive R
  if (!isNullMove && depth >= 3 && !inCheck && !hasDrops && !curseActive
      && countMaterial(state.board) > 4) {
    let kingAttacked = false;
    for (let r = 0; r < 13 && !kingAttacked; r++)
      for (let c = 0; c < 13 && !kingAttacked; c++) {
        const p = state.board[r][c];
        if (p && p.side === state.turn && p.type === 'king')
          kingAttacked = isSquareAttacked(state.board, r, c, opponent(state.turn), state);
      }
    if (!kingAttacked) {
      const saved = state.turn;
      state.turn  = opponent(saved);
      const R = Math.max(2, Math.floor(depth / 3));
      // Null move doesn't change board — maps remain valid
      // ES: El movimiento nulo no cambia el tablero — los mapas siguen siendo válidos
      const nullScore = -search(state, depth - 1 - R, -beta, -alpha, deadline, tt,
        hash ^ ZobristTurn[0] ^ ZobristTurn[1], staticEval, true, maps);
      state.turn = saved;
      if (maximizing && nullScore >= beta)  return beta;
      if (!maximizing && nullScore <= alpha) return alpha;
    }
  }

  // IIR — Internal Iterative Reduction
  const ttMoveKey = cached?.bestMoveKey ?? null;
  let effectiveDepth = depth;
  if (!ttMoveKey && depth >= 5 && !inCheck) {
    effectiveDepth = depth - 1;
  }

  let hashFlag = TT_ALPHA, bestMoveForTT = null;
  const scoredMoves = [];
  for (let mi = 0; mi < rawMoves.length; mi++) {
    const m = rawMoves[mi];
    if (!m) continue;
    if (!m.fromReserve && !m.from) continue;
    const s = moveOrderScore(state, m, depth, hash);
    scoredMoves.push({ move: m, score: ttMoveKey && moveKeyUint32(m, m.promotion) === ttMoveKey ? s + 1_000_000 : s });
  }
  scoredMoves.sort((a, b) => b.score - a.score);
  const moves = [];
  for (let i = 0; i < scoredMoves.length; i++) moves.push(scoredMoves[i].move);

  // ProbCut
  if (effectiveDepth >= 4 && !inCheck && Math.abs(beta) < MATE_SCORE / 2) {
    const probDepth  = effectiveDepth - 4;
    const probMargin = 150;
    for (const move of moves) {
      if (isTactical(state, move)) continue;
      if (!move.fromReserve && state.board[move.to?.r]?.[move.to?.c]) {
        if (!isSEEPositive(state, move, buildAttackMap)) continue;
      }
      const md = makeMove(state, move, false, hash, staticEval);
      if (!md.action) continue;
      const childMaps = _applyMaps(maps, state, move, md, false);
      try {
        const probScore = -search(state, probDepth, -beta - probMargin, -beta + probMargin,
          deadline, tt, md.hash, null, false, childMaps ? maps : null);
        if (probScore >= beta) {
          tt.set(hash, { depth, score: probScore, flag: TT_BETA,
            bestMoveKey: moveKeyUint32(move, move.promotion) });
          return probScore;
        }
      } finally {
        unmakeMove(state, md);
        if (childMaps) _rebuildMaps(maps, state.board);
      }
    }
  }

  let best = maximizing ? -INF : INF, moveCount = 0;
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    if (!inCheck && effectiveDepth <= 3 && staticEval !== null && !move.fromReserve) {
      const margin    = FUTILITY_MARGIN[Math.min(effectiveDepth, 3)];
      const isCapture = !!state.board[move.to?.r]?.[move.to?.c];
      if (!isCapture && !isTactical(state, move)) {
        if (maximizing  && staticEval + margin <= alpha) continue;
        if (!maximizing && staticEval - margin >= beta)  continue;
      }
    }
    for (const promote of getBranches(state, move)) {
      moveCount++;
      const tactical  = isTactical(state, move) || promote;
      const md        = makeMove(state, move, promote, hash, staticEval);
      if (!md.action || !md.undo) continue;
      // INCR: update maps for child node, rebuild on unmake
      // ES: actualizar mapas para nodo hijo, reconstruir en unmake
      const childMaps = _applyMaps(maps, state, move, md, promote);
      try {
        let score;
        const childEval = md.evalDiff ? staticEval + md.evalDiff : null;
        if (moveCount === 1) {
          score = -search(state, effectiveDepth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? maps : null);
        } else {
          let reduction = 0;
          if (effectiveDepth >= 3 && moveCount >= 3 && !tactical && !inCheck) {
            reduction = Math.floor(Math.log(effectiveDepth) * Math.log(moveCount) / 2);
            reduction = Math.max(1, Math.min(reduction, effectiveDepth - 2));
          }
          score = -search(state, effectiveDepth - 1 - reduction, -alpha - 1, -alpha, deadline, tt,
            md.hash, childEval, false, childMaps ? maps : null);
          if (score > alpha && reduction > 0)
            score = -search(state, effectiveDepth - 1, -alpha - 1, -alpha, deadline, tt,
              md.hash, childEval, false, childMaps ? maps : null);
          if (score > alpha && score < beta)
            score = -search(state, effectiveDepth - 1, -beta, -alpha, deadline, tt,
              md.hash, childEval, false, childMaps ? maps : null);
        }
        if (maximizing) {
          if (score > best) { best = score; bestMoveForTT = move; }
          if (best > alpha) { alpha = best; hashFlag = TT_EXACT; }
        } else {
          if (score < best) { best = score; bestMoveForTT = move; }
          if (best < beta)  { beta  = best; hashFlag = TT_EXACT; }
        }
        if (alpha >= beta) {
          if (isQuiet(state, move, promote)) {
            storeKiller(depth, move);
            storeHistory(state.turn, move, depth);
          }
          tt.set(hash, { depth, score: best, flag: TT_BETA,
            bestMoveKey: moveKeyUint32(bestMoveForTT || move, (bestMoveForTT || move).promotion) });
          return best;
        }
      } finally {
        unmakeMove(state, md);
        if (childMaps) _rebuildMaps(maps, state.board);
      }
    }
  }
  tt.set(hash, { depth, score: best, flag: hashFlag,
    bestMoveKey: bestMoveForTT ? moveKeyUint32(bestMoveForTT, bestMoveForTT.promotion) : null });
  return best;
}

// ── searchRoot ───────────────────────────────────────────────────────────────
export function searchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore, rootNNByMoveKey = null, danceTracker = null) {
  const maximizing = state.turn === SIDE.BLACK;
  const cached     = tt.get(hash);
  const ttMoveKey  = cached?.bestMoveKey ?? null;

  // Activate the dance tracker for this search pass so moveOrderScore can use it.
  // It is set before any move scoring and cleared on return, so concurrent calls
  // in workers won't interfere (each worker gets its own module instance).
  // ES: Activar el tracker de baile para este pase de búsqueda.
  _activeDanceTracker = danceTracker ?? null;

  const rawMoves = getAllLegalMoves(state, state.turn);
  dbg.search.group(`searchRoot d=${depth}`, {
    moves:     rawMoves.length,
    alpha, beta,
    ttHit:     !!cached,
    turn:      state.turn,
    prevScore,
  });

  const scoredMoves = [];
  // Tiny random seed per call to break symmetric tie repetition loops
  // ES: Pequeña semilla aleatoria por llamada para romper bucles de repetición simétrica
  const rng = (Math.random() - 0.5) * 0.01;
  for (let mi = 0; mi < rawMoves.length; mi++) {
    const m = rawMoves[mi];
    if (!m) continue;
    if (!m.fromReserve && !m.from) continue;
    const s = moveOrderScore(state, m, depth, hash);
    const mk = moveKeyUint32(m, m.promotion ?? false);
    const nnRaw = rootNNByMoveKey ? (rootNNByMoveKey.get?.(mk) ?? rootNNByMoveKey[mk] ?? null) : null;
    const nnBonus = typeof nnRaw === 'number' && Number.isFinite(nnRaw) ? Math.max(-250, Math.min(250, Math.round(nnRaw * 180))) : 0;
    // rng adds tiny random noise (±0.005) to break ties without affecting strong preferences
    // ES: rng agrega ruido aleatorio mínimo (±0.005) para romper empates sin afectar preferencias fuertes
    scoredMoves.push({ move: m, score: s + nnBonus + (ttMoveKey && mk === ttMoveKey ? 1_000_000 : 0) + rng });
  }
  scoredMoves.sort((a, b) => b.score - a.score);
  const moves = [];
  for (let i = 0; i < scoredMoves.length; i++) moves.push(scoredMoves[i].move);

  if (!moves.length) {
    const term = terminalScore(state, depth, rawMoves);
    return { bestMove: null, score: term ?? prevScore };
  }

  // INCR: Build incremental attack maps once at the root — all child search() calls
  // receive these maps and update them incrementally. At the root we rebuild after
  // each unmake since each root move is independent (no shared subtree state).
  // ES: Construir mapas incrementales una vez en la raíz. Los nodos hijos los reciben
  // y actualizan incrementalmente. En la raíz se reconstruyen después de cada unmake.
  let rootMaps = null;
  try {
    rootMaps = createIncrementalMaps(state.board);
  } catch { rootMaps = null; }

  const thirdRepMoveKeys = new Set();
  if (state.history?.length >= 2 && moves.length > 1) {
    for (const m of moves) {
      for (const pr of getBranches(state, m)) {
        const probe = makeMove(state, m, pr, hash, prevScore);
        if (probe.action && probe.undo) {
          if (countRepetitions(state.history, probe.hash) >= 3) {
            thirdRepMoveKeys.add(moveKeyUint32(m, pr));
          }
        }
        if (probe.undo) unmakeMove(state, probe);
      }
    }
    if (thirdRepMoveKeys.size >= moves.length) thirdRepMoveKeys.clear();
  }

  let bestMove = null, bestScore = maximizing ? -INF : INF, moveCount = 0;

  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    for (const promote of getBranches(state, move)) {
      if (thirdRepMoveKeys.has(moveKeyUint32(move, promote))) {
        dbg.ai.warn('searchRoot: skipping 3rd-rep move', { move: moveKey(move, promote) });
        continue;
      }
      moveCount++;
      const md = makeMove(state, move, promote, hash, prevScore);
      if (!md.action || !md.undo) continue;
      // INCR: update maps for root move child
      // ES: actualizar mapas para el movimiento raíz hijo
      const childMaps = _applyMaps(rootMaps, state, move, md, promote);
      try {
        let score;
        const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
        if (moveCount === 1) {
          score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
        } else {
          score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
          if (score > alpha && score < beta)
            score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
        }
        const cand = md.action;
        if (!cand) continue;
        if (maximizing) {
          if (score > bestScore) { bestScore = score; bestMove = cand; }
          if (bestScore > alpha) alpha = bestScore;
        } else {
          if (score < bestScore) { bestScore = score; bestMove = cand; }
          if (bestScore < beta)  beta = bestScore;
        }
        if (score > (maximizing ? bestScore - 100 : bestScore + 100) || moveCount <= 2) {
          dbg.search(`  move #${moveCount}`, {
            move: moveKey(move, promote), score,
            best: moveKey(bestMove, false), alpha, beta,
          });
        }
        if (alpha >= beta) {
          dbg.search(`  beta cutoff`, { move: moveKey(move, promote), score, best: moveKey(bestMove, false) });
          if (isQuiet(state, move, promote)) {
            storeKiller(depth, move);
            storeHistory(state.turn, move, depth);
          }
          tt.set(hash, { depth, score: bestScore, flag: TT_BETA,
            bestMoveKey: moveKeyUint32(bestMove || cand, (bestMove || cand).promotion) });
          return { bestMove, score: bestScore };
        }
      } finally {
        unmakeMove(state, md);
        // INCR: rebuild after each root unmake — root moves are independent
        // ES: reconstruir después de cada unmake en la raíz — son independientes
        if (childMaps) _rebuildMaps(rootMaps, state.board);
      }
    }
  }

  if (moveCount === 0 && moves.length > 0) {
    dbg.ai.warn('searchRoot: all moves were vetoed, retrying without rep-veto');
    for (const move of moves) {
      if (now() > deadline) throw new SearchTimeout();
      for (const promote of getBranches(state, move)) {
        moveCount++;
        const md = makeMove(state, move, promote, hash, prevScore);
        if (!md.action || !md.undo) continue;
        const childMaps = _applyMaps(rootMaps, state, move, md, promote);
        try {
          let score;
          const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
          if (moveCount === 1) {
            score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
          } else {
            score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
            if (score > alpha && score < beta)
              score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
          }
          const cand = md.action;
          if (!cand) continue;
          if (maximizing) {
            if (score > bestScore) { bestScore = score; bestMove = cand; }
            if (bestScore > alpha) alpha = bestScore;
          } else {
            if (score < bestScore) { bestScore = score; bestMove = cand; }
            if (bestScore < beta)  beta = bestScore;
          }
          if (alpha >= beta) {
            tt.set(hash, { depth, score: bestScore, flag: TT_BETA,
              bestMoveKey: moveKeyUint32(bestMove || cand, (bestMove || cand).promotion) });
            return { bestMove, score: bestScore };
          }
        } finally {
          unmakeMove(state, md);
          if (childMaps) _rebuildMaps(rootMaps, state.board);
        }
      }
    }
  }

  tt.set(hash, { depth, score: bestScore, flag: TT_ALPHA,
    bestMoveKey: bestMove ? moveKeyUint32(bestMove, bestMove.promotion) : null });
  _activeDanceTracker = null;
  return { bestMove, score: bestScore };
}

function getBranches(state, move) {
  if (isValidMove(move) && !move.fromReserve && move.from && move.to
      && isPromotionAvailableForMove(state, move.from, move.to))
    return [true, false];
  return [false];
}

function isValidMove(move) {
  if (!move || typeof move !== 'object') return false;
  if (move.fromReserve)
    return Number.isInteger(move.reserveIndex)
      && move.to && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
  return move.from && move.to
    && Number.isInteger(move.from.r) && Number.isInteger(move.from.c)
    && Number.isInteger(move.to.r)   && Number.isInteger(move.to.c);
}

function isBacktrack(state, move) {
  const last = state.lastMove;
  if (!last || move.fromReserve || !last.from || !last.to || !move.from || !move.to) return false;
  return move.from.r === last.to.r && move.from.c === last.to.c
      && move.to.r   === last.from.r && move.to.c === last.from.c;
}

function kingPenalty(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c];
  if (!piece || piece.type !== 'king') return 0;
  let pen = 0;
  const KING_MOVE_PENALTY = 120;
  if (!isPalaceSquare(move.to.r, move.to.c, piece.side))   pen += KING_MOVE_PENALTY;
  if (isPalaceSquare(move.from.r, move.from.c, piece.side)
   && !isPalaceSquare(move.to.r, move.to.c, piece.side))   pen += 80;
  if (!isKingInCheck(state, piece.side))                    pen += 40;
  return pen;
}

function kingShufflePen(state, move) {
  const KING_SHUFFLE_PENALTY = 300;
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c];
  if (!piece || piece.type !== 'king') return 0;
  const last = state.lastMove;
  if (!last?.from || !last?.to) return 0;
  return (last.from.r === move.to.r && last.from.c === move.to.c
       && last.to.r   === move.from.r && last.to.c === move.from.c)
    ? KING_SHUFFLE_PENALTY : 0;
}

function shufflePenalty(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c];
  if (!piece || piece.type === 'king') return 0;
  const target = state.board?.[move.to.r]?.[move.to.c] ?? null;
  let pen = 0;
  if (!target) {
    const dist = Math.abs(move.to.r - move.from.r) + Math.abs(move.to.c - move.from.c);
    if (dist <= 1) pen += 180;
    else if (dist === 2) pen += 90;
    const forward = piece.side === SIDE.WHITE ? 1 : -1;
    const advance = (move.to.r - move.from.r) * forward;
    if (advance <= 0) pen += 120;
  }
  return pen;
}

function countMaterial(board) {
  let count = 0;
  for (let r = 0; r < 13; r++)
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (p && p.type !== 'king' && p.type !== 'pawn') count++;
    }
  return count;
}

function moveOrderScore(state, move, depth, currentHash = null) {
  if (!isValidMove(move)) return -999_999;
  const side   = state.turn;
  const moving = move.fromReserve
    ? state.reserves[side]?.[move.reserveIndex]
    : state.board?.[move.from?.r]?.[move.from?.c];
  if (!moving || !move.to) return -999_999;

  const target = state.board?.[move.to.r]?.[move.to.c] ?? null;
  let score = 0;
  const PALACE_PRESSURE_BONUS = 350;

  if (target) {
    const victimVal   = pieceValue(target);
    const attackerVal = pieceValue(moving);
    const tradeBonus  = victimVal > attackerVal ? 2000 : (victimVal === attackerVal ? 1000 : -500);
    score += victimVal * 12 - attackerVal * 2 + tradeBonus;
  }

  if (!move.fromReserve && move.from && move.to
      && isPromotionAvailableForMove(state, move.from, move.to) && !moving.promoted)
    score += 280;

  score += (12 - Math.abs(move.to.r - 6) - Math.abs(move.to.c - 6)) * 2;

  if (!move.fromReserve && moving.type === 'archer' && onBank(side, move.to.r)) score += 400;
  if (!move.fromReserve && moving.type === 'archer') {
    const forward = side === SIDE.WHITE ? 1 : -1;
    if ((move.to.r - move.from.r) * forward > 0) score += 50;
  }

  if (!move.fromReserve && moving.type !== 'king') {
    const enemyBaseRow = side === SIDE.WHITE ? 12 : 0;
    const f            = side === SIDE.WHITE ? 1  : -1;
    const dist         = (enemyBaseRow - move.to.r) * f;
    if (dist < 6) score += (6 - dist) * 10;
  }

  if (move.fromReserve) {
    score += 100;
    if ((side === SIDE.WHITE && move.to.r >= 7) || (side === SIDE.BLACK && move.to.r <= 5)) score += 80;
    if ((side === SIDE.WHITE && move.to.r >= 9) || (side === SIDE.BLACK && move.to.r <= 3)) score += 60;
  }

  const enemy = opponent(side);
  if (isPalaceSquare(move.to.r, move.to.c, enemy)) score += PALACE_PRESSURE_BONUS;

  if (isBacktrack(state, move)) score -= 500;
  score -= kingPenalty(state, move);
  score -= kingShufflePen(state, move);
  score -= shufflePenalty(state, move);

  // ── Anti-dance penalties (oscillation + stagnation) ──────────────────────
  // These fire for any non-king non-capture quiet move. Captures are
  // intrinsically progress (they change material) so we skip them.
  // ES: Penalizaciones anti-baile: oscilación y estancamiento.
  if (!move.fromReserve && moving && moving.type !== 'king') {
    const isCapture = !!target;
    if (!isCapture) {
      score -= oscillationPenalty(side, moving, move.from.r, move.from.c, move.to.r, move.to.c);
      score -= stagnationPenalty(side, moving, move.from.r, move.from.c, move.to.r, move.to.c);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const mk = moveKeyUint32(move, move.promotion ?? false);
  score += killerScore(depth, mk);
  score += Math.min(120, historyScore(side, mk) / 10);
  score -= Math.min(1200, adaptiveMemory.getMovepenalty(moveKey(move, move.promotion ?? false)));

  if (currentHash !== null && state.history?.length >= 2) {
    let futureHash = null;
    const md = makeMove(state, move, move.promotion ?? false, currentHash);
    if (md.action) {
      futureHash = md.hash;
      unmakeMove(state, md);
    }
    if (futureHash !== null) {
      const seen = countRepetitions(state.history, futureHash);
      const priorSeen = Math.max(0, seen - 1);
      if (priorSeen >= 2) {
        score -= 2_000_000;  // third repetition → completely forbidden (exceeds TT bonus)
      } else if (priorSeen === 1) {
        score -= 3000;
      } else {
        const drawPen = adaptiveMemory.getDrawPenalty(futureHash.toString());
        score -= Math.min(1200, drawPen);
      }
    }
  }

  if (!move.fromReserve) {
    let forkCount = 0;
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nr = move.to.r + dr, nc = move.to.c + dc;
      if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
        const p = state.board[nr][nc];
        if (p && p.side === enemy && pieceValue(p) > 250) forkCount++;
      }
    }
    if (forkCount >= 2) score += 120 * forkCount;
  }

  return score;
}

export function allocateTime(startTime, timeLimitMs, moveCount = 30) {
  const elapsed     = now() - startTime;
  const remaining   = timeLimitMs - elapsed;
  const movesLeft   = Math.max(5, moveCount - 10);
  const timePerMove = remaining / movesLeft;
  return Math.min(timePerMove * 0.8, timeLimitMs * 0.3);
}