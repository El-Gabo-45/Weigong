import { SIDE, opponent, isPalaceSquare, onBank, isPromotableType } from '../constants.js';
import { getAllLegalMoves, isKingInCheck, isPromotionAvailableForMove } from '../rules/index.js';
import { computeFullHash, TranspositionTable, ZobristTurn } from './hashing.js';
import { evaluate, gamePhaseFactor, buildAttackMap } from './evaluation.js';
import { makeMove, unmakeMove, isSEEPositive, pieceValue } from './moves.js';
import { adaptiveMemory } from './memory.js';

const MATE_SCORE = 1_000_000;
const INF        = 1_000_000_000;
const TT_EXACT = 0, TT_ALPHA = 1, TT_BETA = 2;
const FUTILITY_MARGIN = [0, 150, 300, 500];

const killerMoves  = new Map();
const historyTable = { white: new Map(), black: new Map() };
const KILLER_SLOTS = 2;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

class SearchTimeout extends Error {}

export function moveKey(move, promote = false) {
  if (!move) return 'null';
  if (move.fromReserve) return `R:${move.reserveIndex}->${move.to.r},${move.to.c}`;
  const promotionFlag = promote ? ':p1' : ':p0';
  return `M:${move.from.r},${move.from.c}->${move.to.r},${move.to.c}${promotionFlag}`;
}

function storeKiller(depth, move) {
  const key = moveKey(move, move.promotion);
  const prev = killerMoves.get(depth) ?? [];
  if (prev[0] === key) return;
  killerMoves.set(depth, [key, prev[0] ?? null].filter(Boolean).slice(0, KILLER_SLOTS));
}

function killerScore(depth, move) {
  const arr = killerMoves.get(depth);
  if (!arr) return 0;
  const key = moveKey(move, move.promotion);
  return arr[0] === key ? 900 : arr[1] === key ? 650 : 0;
}

function historyScore(side, move) { return historyTable[side].get(moveKey(move, move.promotion)) ?? 0; }

function storeHistory(side, move, depth) {
  const key = moveKey(move, move.promotion);
  historyTable[side].set(key, (historyTable[side].get(key) ?? 0) + depth * depth);
}

function isQuiet(state, move, promote) { return !move || move.fromReserve || promote ? false : !state.board?.[move.to?.r]?.[move.to?.c]; }

function terminalScore(state, depth) {
  try {
    const legal = getAllLegalMoves(state, state.turn) || []; const inCheck = isKingInCheck(state, state.turn);
    if (legal.length === 0) return inCheck ? (state.turn===SIDE.BLACK ? -MATE_SCORE+depth : MATE_SCORE-depth) : 0;
    return null;
  } catch (err) { console.error('[terminalScore] Error evaluando estado:', err); return null; }
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
  const inCheck = isKingInCheck(state, opponent(state.turn));
  unmakeMove(state, md);
  return inCheck;
}

function quiescence(state, alpha, beta, deadline, hash, staticEval = null) {
  if (now() > deadline) throw new SearchTimeout();
  const maximizing = state.turn === SIDE.BLACK;
  const inCheck = isKingInCheck(state, state.turn);
  const ev = staticEval ?? evaluate(state, hash).score;
  let best = inCheck ? (maximizing ? -INF : INF) : ev;
  if (!inCheck) {
    if (maximizing) { if (best >= beta) return best; alpha = Math.max(alpha, best); }
    else            { if (best <= alpha) return best; beta  = Math.min(beta,  best); }
  }
  const moves = getAllLegalMoves(state, state.turn).filter(m => m && (inCheck || isTactical(state, m))).sort((a,b) => moveOrderScore(state,b,0) - moveOrderScore(state,a,0));
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    if (!inCheck && !move.fromReserve && state.board[move.to?.r]?.[move.to?.c]) { if (!isSEEPositive(state, move, buildAttackMap)) continue; }
    for (const promote of getBranches(state, move)) {
      const md = makeMove(state, move, promote, hash, best);
      if (!md.action || !md.undo) continue;
      const score = -quiescence(state, -beta, -alpha, deadline, md.hash, md.evalDiff ? -best - md.evalDiff : null);
      unmakeMove(state, md);
      if (maximizing) { if (score > best) best = score; alpha = Math.max(alpha, best); if (alpha >= beta) return best; }
      else            { if (score < best) best = score; beta  = Math.min(beta,  best); if (alpha >= beta) return best; }
    }
  }
  return best;
}

export function search(state, depth, alpha, beta, deadline, tt, hash, staticEval = null, isNullMove = false) {
  if (now() > deadline) throw new SearchTimeout();
  const cached = tt.get(hash);
  if (cached && cached.depth >= depth) {
    if (cached.flag === TT_EXACT) return cached.score;
    if (cached.flag === TT_ALPHA && cached.score <= alpha) return alpha;
    if (cached.flag === TT_BETA  && cached.score >= beta)  return beta;
  }
  const term = terminalScore(state, depth);
  if (term !== null) return term;
  if (depth <= 0) return quiescence(state, alpha, beta, deadline, hash, staticEval);

  const maximizing = state.turn === SIDE.BLACK;
  const inCheck = isKingInCheck(state, state.turn);
  if (staticEval === null) staticEval = evaluate(state, hash).score;

  if (!inCheck && depth <= 2) {
    const razorMargin = depth === 1 ? 250 : 450;
    if (maximizing && staticEval + razorMargin <= alpha) return quiescence(state, alpha, beta, deadline, hash, staticEval);
    if (!maximizing && staticEval - razorMargin >= beta) return quiescence(state, alpha, beta, deadline, hash, staticEval);
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
  const hasDrops = state.reserves[state.turn].length > 0;
  const curseActive = state.palaceCurse?.[state.turn]?.active;

  if (!isNullMove && depth >= 3 && !inCheck && !hasDrops && !curseActive && countMaterial(state.board) > 4) {
    const enemyAttackMap = buildAttackMap(state.board, opponent(state.turn)).attackMap;
    let kingAttacked = false;
    for (let r = 0; r < 13 && !kingAttacked; r++) for (let c = 0; c < 13 && !kingAttacked; c++) {
      const p = state.board[r][c]; if (p && p.side === state.turn && p.type === 'king') kingAttacked = (enemyAttackMap.get(`${r},${c}`) ?? 0) > 0;
    }
    if (!kingAttacked) {
      const saved = state.turn; state.turn = opponent(saved);
      const R = depth > 6 ? 3 : 2;
      const nullScore = -search(state, depth-1-R, -beta, -alpha, deadline, tt, hash ^ ZobristTurn[0] ^ ZobristTurn[1], staticEval, true);
      state.turn = saved;
      if (maximizing && nullScore >= beta) return beta;
      if (!maximizing && nullScore <= alpha) return alpha;
    }
  }

  let hashFlag = TT_ALPHA, bestMoveForTT = null;
  const ttMoveKey = cached?.bestMoveKey ?? null;
  const moves = getAllLegalMoves(state, state.turn).filter(m => m && (m.fromReserve || m.from)).map(m => {
    let s = moveOrderScore(state, m, depth);
    if (ttMoveKey && moveKey(m, m.promotion) === ttMoveKey) s += 1_000_000;
    return { move: m, score: s };
  }).sort((a,b) => b.score - a.score).map(o => o.move);

  // ══════════════ PROBCUT ══════════════
  if (depth >= 3 && !inCheck && Math.abs(beta) < MATE_SCORE / 2) {
    const probDepth = depth - 4;
    const probMargin = 150;
    for (const move of moves) {
      if (isTactical(state, move)) continue;
      const md = makeMove(state, move, false, hash, staticEval);
      if (!md.action) continue;
      const probScore = -search(state, probDepth, -beta - probMargin, -beta + probMargin, deadline, tt, md.hash, null, false);
      unmakeMove(state, md);
      if (probScore >= beta) {
        tt.set(hash, { depth, score: probScore, flag: TT_BETA, bestMoveKey: moveKey(move, move.promotion) });
        return probScore;
      }
    }
  }

  let best = maximizing ? -INF : INF, moveCount = 0;
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    if (!inCheck && depth <= 3 && staticEval !== null && !move.fromReserve) {
      const margin = FUTILITY_MARGIN[Math.min(depth, 3)]; const isCapture = !!state.board[move.to?.r]?.[move.to?.c];
      if (!isCapture && !isTactical(state, move)) {
        if (maximizing && staticEval + margin <= alpha) continue;
        if (!maximizing && staticEval - margin >= beta) continue;
      }
    }
    for (const promote of getBranches(state, move)) {
      moveCount++;
      const tactical = isTactical(state, move) || promote;
      const md = makeMove(state, move, promote, hash, staticEval);
      if (!md.action || !md.undo) continue;
      let score;
      const childEval = md.evalDiff ? staticEval + md.evalDiff : null;
      if (moveCount === 1) {
        score = -search(state, depth-1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
      } else {
        let reduction = 0;
        if (depth >= 3 && moveCount >= 3 && !tactical && !inCheck) {
          reduction = Math.floor(Math.log(depth) * Math.log(moveCount) / 2);
          reduction = Math.max(1, Math.min(reduction, depth - 2));
        }
        score = -search(state, depth-1-reduction, -alpha-1, -alpha, deadline, tt, md.hash, childEval, false);
        if (score > alpha && reduction > 0) score = -search(state, depth-1, -alpha-1, -alpha, deadline, tt, md.hash, childEval, false);
        if (score > alpha && score < beta)  score = -search(state, depth-1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
      }
      unmakeMove(state, md);
      if (maximizing) { if (score > best) { best = score; bestMoveForTT = move; } if (best > alpha) { alpha = best; hashFlag = TT_EXACT; } }
      else            { if (score < best) { best = score; bestMoveForTT = move; } if (best < beta)  { beta  = best; hashFlag = TT_EXACT; } }
      if (alpha >= beta) {
        if (isQuiet(state, move, promote)) { storeKiller(depth, move); storeHistory(state.turn, move, depth); }
        tt.set(hash, { depth, score: best, flag: TT_BETA, bestMoveKey: moveKey(bestMoveForTT||move, (bestMoveForTT||move).promotion) });
        return best;
      }
    }
  }
  tt.set(hash, { depth, score: best, flag: hashFlag, bestMoveKey: bestMoveForTT ? moveKey(bestMoveForTT, bestMoveForTT.promotion) : null });
  return best;
}

export function searchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore) {
  const maximizing = state.turn === SIDE.BLACK;
  const cached = tt.get(hash); const ttMoveKey = cached?.bestMoveKey ?? null;
  const moves = getAllLegalMoves(state, state.turn).filter(m => m && (m.fromReserve || m.from)).map(m => {
    let s = moveOrderScore(state, m, depth);
    if (ttMoveKey && moveKey(m, m.promotion) === ttMoveKey) s += 1_000_000;
    return { move: m, score: s };
  }).sort((a,b) => b.score - a.score).map(o => o.move);
  if (!moves.length) { const term = terminalScore(state, depth); return { bestMove: null, score: term ?? prevScore }; }
  let bestMove = null, bestScore = maximizing ? -INF : INF, moveCount = 0;
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    for (const promote of getBranches(state, move)) {
      moveCount++;
      const md = makeMove(state, move, promote, hash, prevScore);
      if (!md.action || !md.undo) continue;
      let score;
      const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
      if (moveCount === 1) score = -search(state, depth-1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
      else {
        score = -search(state, depth-1, -alpha-1, -alpha, deadline, tt, md.hash, childEval, false);
        if (score > alpha && score < beta) score = -search(state, depth-1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
      }
      const cand = { ...md.action }; unmakeMove(state, md);
      if (maximizing) { if (score > bestScore) { bestScore = score; bestMove = cand; } if (bestScore > alpha) alpha = bestScore; }
      else { if (score < bestScore) { bestScore = score; bestMove = cand; } if (bestScore < beta) beta = bestScore; }
      if (alpha >= beta) {
        if (isQuiet(state, move, promote)) { storeKiller(depth, move); storeHistory(state.turn, move, depth); }
        tt.set(hash, { depth, score: bestScore, flag: TT_BETA, bestMoveKey: moveKey(bestMove||cand, (bestMove||cand).promotion) });
        return { bestMove, score: bestScore };
      }
    }
  }
  tt.set(hash, { depth, score: bestScore, flag: TT_ALPHA, bestMoveKey: bestMove ? moveKey(bestMove, bestMove.promotion) : null });
  return { bestMove, score: bestScore };
}

function getBranches(state, move) {
  if (isValidMove(move) && !move.fromReserve && move.from && move.to && isPromotionAvailableForMove(state, move.from, move.to)) return [true, false];
  return [false];
}

function isValidMove(move) {
  if (!move || typeof move !== 'object') return false;
  if (move.fromReserve)
    return Number.isInteger(move.reserveIndex) && move.to && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
  return move.from && move.to && Number.isInteger(move.from.r) && Number.isInteger(move.from.c) && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
}

function isBacktrack(state, move) {
  const last = state.lastMove;
  if (!last || move.fromReserve || !last.from || !last.to || !move.from || !move.to) return false;
  return move.from.r===last.to.r && move.from.c===last.to.c && move.to.r===last.from.r && move.to.c===last.from.c;
}

function kingPenalty(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c]; if (!piece || piece.type !== 'king') return 0;
  let pen = 0;
  const KING_MOVE_PENALTY = 120;
  if (!isPalaceSquare(move.to.r,move.to.c,piece.side)) pen += KING_MOVE_PENALTY;
  if (isPalaceSquare(move.from.r,move.from.c,piece.side) && !isPalaceSquare(move.to.r,move.to.c,piece.side)) pen += 80;
  if (!isKingInCheck(state, piece.side)) pen += 40;
  return pen;
}

function kingShufflePen(state, move) {
  const KING_SHUFFLE_PENALTY = 400;
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c]; if (!piece || piece.type !== 'king') return 0;
  const last = state.lastMove; if (!last?.from || !last?.to) return 0;
  return (last.from.r===move.to.r && last.from.c===move.to.c && last.to.r===move.from.r && last.to.c===move.from.c) ? KING_SHUFFLE_PENALTY : 0;
}

function moveOrderScore(state, move, depth) {
  if (!isValidMove(move)) return -999_999;
  const side = state.turn;
  const moving = move.fromReserve
    ? state.reserves[side]?.[move.reserveIndex]
    : state.board?.[move.from?.r]?.[move.from?.c];
  if (!moving || !move.to) return -999_999;

  const target = state.board?.[move.to.r]?.[move.to.c] ?? null;
  let score = 0;
  const PALACE_PRESSURE_BONUS = 350;

  if (target) {
    const seeScore = isSEEPositive(state, move, buildAttackMap)
      ? pieceValue(target) * 12 - pieceValue(moving) * 2 + 2000
      : pieceValue(target) * 12 - pieceValue(moving) * 2 - 500;
    score += seeScore;
  }

  if (!move.fromReserve && move.from && move.to &&
      isPromotionAvailableForMove(state, move.from, move.to) && !moving.promoted)
    score += 280;

  score += (12 - Math.abs(move.to.r - 6) - Math.abs(move.to.c - 6)) * 2;

  if (!move.fromReserve && moving.type === 'archer' && onBank(side, move.to.r)) score += 400;
  if (!move.fromReserve && moving.type === 'archer') {
    const forward = side === SIDE.WHITE ? 1 : -1;
    if ((move.to.r - move.from.r) * forward > 0) score += 50;
  }

  if (!move.fromReserve && moving.type !== 'king') {
    const enemyBaseRow = side === SIDE.WHITE ? 12 : 0;
    const f = side === SIDE.WHITE ? 1 : -1;
    const dist = (enemyBaseRow - move.to.r) * f;
    if (dist < 6) score += (6 - dist) * 10;
  }

  if (move.fromReserve) {
    score += 100;
    if ((side === SIDE.WHITE && move.to.r >= 7) || (side === SIDE.BLACK && move.to.r <= 5)) score += 80;
    if ((side === SIDE.WHITE && move.to.r >= 9) || (side === SIDE.BLACK && move.to.r <= 3)) score += 60;
  }

  const enemy = opponent(side);
  if (isPalaceSquare(move.to.r, move.to.c, enemy)) score += PALACE_PRESSURE_BONUS;
  const IMMEDAITE_BACKTRACK_PENALTY = 500;
  if (isBacktrack(state, move)) score -= IMMEDAITE_BACKTRACK_PENALTY;
  score -= kingPenalty(state, move);
  score -= kingShufflePen(state, move);
  score += killerScore(depth, move);
  score += Math.min(200, historyScore(side, move) / 8);

  const mk = moveKey(move, move.promotion);
  score -= adaptiveMemory.getMovepenalty(mk);

  if (state.history && state.history.length >= 4) {
    const currentHash = computeFullHash(state);
    const futureHash = currentHash ^ ZobristTurn[0] ^ ZobristTurn[1];
    let seen = 0;
    for (const h of state.history) if (h === futureHash) seen++;
    if (seen >= 3) score -= 8000;
    else {
      const drawPen = adaptiveMemory.getDrawPenalty(futureHash.toString());
      score -= drawPen;
    }
  }

  if (!move.fromReserve) {
    let forkCount = 0;
    const FORK_BONUS = 120;
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nr = move.to.r + dr, nc = move.to.c + dc;
      if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
        const p = state.board[nr][nc];
        if (p && p.side === enemy && pieceValue(p) > 250) forkCount++;
      }
    }
    if (forkCount >= 2) score += FORK_BONUS * forkCount;
  }

  return score;
}

export function allocateTime(startTime, timeLimitMs, moveCount = 30) {
  const elapsed = now() - startTime; const remaining = timeLimitMs - elapsed;
  const movesLeft = Math.max(5, moveCount - 10); const timePerMove = remaining / movesLeft;
  return Math.min(timePerMove * 0.8, timeLimitMs * 0.3);
}