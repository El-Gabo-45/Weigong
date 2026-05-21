import { dbg } from '../debug/debug.js';
import { SIDE, opponent, isPromotableType, isPalaceSquare, onBank } from '../constants.js';
import { applyMove, isPromotionAvailableForMove } from '../rules/index.js';
import {
  xorPiece, xorReserves, ZobristTurn, ZobristPalaceWhite, ZobristPalaceBlack,
  SIDE_INDEX, PIECE_INDEX
} from './hashing.js';

// ── Reusable board pool for SEE ──
const BOARD_POOL_SIZE = 64;
let boardPoolIdx = 0;
const boardPool = [];
for (let i = 0; i < BOARD_POOL_SIZE; i++) {
  const b = new Array(13);
  for (let r = 0; r < 13; r++) b[r] = new Array(13).fill(null);
  boardPool.push(b);
}

function acquireBoard() {
  const b = boardPool[boardPoolIdx];
  boardPoolIdx = (boardPoolIdx + 1) % BOARD_POOL_SIZE;
  return b;
}

function copyBoard(dst, src) {
  for (let r = 0; r < 13; r++) {
    const rowDst = dst[r];
    const rowSrc = src[r];
    for (let c = 0; c < 13; c++) rowDst[c] = rowSrc[c];
  }
  return dst;
}

const UNDO_POOL_SIZE = 4096;
let undoPoolIdx = 0;
const undoPool = [];
for (let i = 0; i < UNDO_POOL_SIZE; i++) {
  undoPool.push({
    cells: new Array(8).fill(null),
    cellCount: 0,
    turn: null, lastMove: null,
    reservesW: null, reservesB: null,
    palaceTaken: null, palaceTimers: null, palaceCurse: null,
    history: null, hash: null, eval: null,
  });
}

function acquireUndo() {
  const u = undoPool[undoPoolIdx];
  undoPoolIdx = (undoPoolIdx + 1) % UNDO_POOL_SIZE;
  u.cellCount = 0;
  u.turn = null; u.lastMove = null;
  u.reservesW = null; u.reservesB = null;
  u.palaceTaken = null; u.palaceTimers = null; u.palaceCurse = null;
  u.history = null; u.hash = null; u.eval = null;
  return u;
}

const ARCHER_DC = [-1, 0, 1];

export function isValidMove(move) {
  if (!move || typeof move !== 'object') return false;
  if (move.fromReserve)
    return Number.isInteger(move.reserveIndex) && move.to && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
  return move.from && move.to && Number.isInteger(move.from.r) && Number.isInteger(move.from.c) && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
}

export function makeMove(state, move, promote, currentHash, currentEval = null) {
  const t = dbg.perf.start('makeMove');
  if (!isValidMove(move)) {
    dbg.moves.warn('makeMove invalid', { move, promote });
    dbg.perf.end(t);
    return { action: null, undo: null, hash: currentHash, evalDiff: 0 };
  }
  const from = move.from ?? null, to = move.to ?? null;
  const undo = acquireUndo();
  undo.turn = state.turn;
  undo.lastMove = state.lastMove ? { from: state.lastMove.from ? { ...state.lastMove.from } : null, to: state.lastMove.to ? { ...state.lastMove.to } : null } : null;
  undo.hash = currentHash;
  undo.eval = currentEval;

  const rw = state.reserves.white;
  const rb = state.reserves.black;
  if (rw.length > 0 || rb.length > 0) {
    undo.reservesW = rw.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id }));
    undo.reservesB = rb.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id }));
  } else {
    undo.reservesW = null;
    undo.reservesB = null;
  }

  undo.palaceTaken = state.palaceTaken ? { white: state.palaceTaken.white, black: state.palaceTaken.black } : null;
  undo.palaceTimers = state.palaceTimers ? { white: { ...state.palaceTimers.white }, black: { ...state.palaceTimers.black } } : null;
  undo.palaceCurse = state.palaceCurse ? { white: { ...state.palaceCurse.white }, black: { ...state.palaceCurse.black } } : null;
  undo.history = state.history ? [...state.history] : [];
  undo.cellCount = 0;

  if (!move.fromReserve && from && state.board[from.r]?.[from.c]) {
    const ci = undo.cellCount++;
    undo.cells[ci] = { r: from.r, c: from.c, p: { ...state.board[from.r][from.c] } };
  }
  if (to) {
    const ci = undo.cellCount++;
    undo.cells[ci] = { r: to.r, c: to.c, p: state.board[to.r]?.[to.c] ? { ...state.board[to.r][to.c] } : null };
  }
  const action = normalizeMove(move, promote);
  if (!action) {
    dbg.perf.end(t);
    return { action: null, undo, hash: currentHash, evalDiff: 0 };
  }

  let evalDiff = 0;
  if (currentEval !== null) {
    if (!move.fromReserve && from) {
      const piece = state.board[from.r][from.c];
      if (piece) {
        const target = to ? state.board[to.r]?.[to.c] : null;
        evalDiff -= pieceValue(piece) + pieceSquareBonus(piece, from.r, from.c);
        evalDiff += pieceValue(piece) + pieceSquareBonus(piece, to.r, to.c);
        if (target && target.side !== piece.side) evalDiff -= pieceValue(target) + pieceSquareBonus(target, to.r, to.c);
        if (promote && !piece.promoted && isPromotionAvailableForMove(state, from, to)) {
          const oldVal = pieceValue(piece); piece.promoted = true; const newVal = pieceValue(piece); piece.promoted = false;
          evalDiff += newVal - oldVal;
        }
        evalDiff *= (piece.side === SIDE.BLACK) ? 1 : -1;
      }
    } else if (move.fromReserve) {
      const entry = state.reserves[state.turn]?.[move.reserveIndex];
      if (entry) { evalDiff += pieceValue(entry) + pieceSquareBonus(entry, to.r, to.c); evalDiff *= (state.turn === SIDE.BLACK) ? 1 : -1; }
    }
  }
  if (!move.fromReserve && from && state.board[from.r]?.[from.c]?.type === 'archer' && to) {
    const f = state.turn === SIDE.WHITE ? 1 : -1;
    for (let di = 0; di < 3; di++) {
      const dc = ARCHER_DC[di];
      const nr = to.r + f, nc = to.c + dc;
      if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
        const ci = undo.cellCount++;
        undo.cells[ci] = { r: nr, c: nc, p: state.board[nr][nc] ? { ...state.board[nr][nc] } : null };
      }
    }
  }

  let newHash = currentHash;
  if (!move.fromReserve && from && state.board[from.r]?.[from.c]) newHash = xorPiece(newHash, from.r, from.c, state.board[from.r][from.c]);
  if (to && state.board[to.r]?.[to.c]) newHash = xorPiece(newHash, to.r, to.c, state.board[to.r][to.c]);
  newHash = xorReserves(newHash, state.reserves.white, 0);
  newHash = xorReserves(newHash, state.reserves.black, 1);
  const oldPalH = (state.palaceTaken?.white ? ZobristPalaceWhite : 0n) ^ (state.palaceTaken?.black ? ZobristPalaceBlack : 0n);
  applyMove(state, action);
  if (to && state.board[to.r]?.[to.c]) newHash = xorPiece(newHash, to.r, to.c, state.board[to.r][to.c]);
  newHash = xorReserves(newHash, state.reserves.white, 0);
  newHash = xorReserves(newHash, state.reserves.black, 1);
  const newPalH = (state.palaceTaken?.white ? ZobristPalaceWhite : 0n) ^ (state.palaceTaken?.black ? ZobristPalaceBlack : 0n);
  newHash ^= oldPalH ^ newPalH ^ ZobristTurn[0] ^ ZobristTurn[1];
  state.history = state.history ?? []; state.history.push(currentHash);
  dbg.moves('makeMove', { from: from ? `${from.r},${from.c}` : 'R', to: to ? `${to.r},${to.c}` : 'R', promote, evalDiff: evalDiff.toFixed(1) });
  dbg.perf.end(t);
  return { action, undo, hash: newHash, evalDiff };
}

export function unmakeMove(state, { undo }) {
  if (!undo) return;
  for (let i = 0; i < undo.cellCount; i++) {
    const cell = undo.cells[i];
    state.board[cell.r][cell.c] = cell.p;
  }
  state.turn = undo.turn; state.lastMove = undo.lastMove; state.history = undo.history;
  state.palaceTaken = undo.palaceTaken; state.palaceTimers = undo.palaceTimers;
  if (undo.reservesW !== null) state.reserves.white = undo.reservesW;
  if (undo.reservesB !== null) state.reserves.black = undo.reservesB;
  if (undo.palaceCurse) state.palaceCurse = undo.palaceCurse;
}

const PIECE_VALUES = {
  king: 0, queen: 950, general: 560, elephant: 240, priest: 400,
  horse: 320, cannon: 450, tower: 520, carriage: 390, archer: 450,
  pawn: 110, crossbow: 240,
};
const PROMOTED_VALUES = {
  pawn: 240, tower: 520, horse: 430, elephant: 320, priest: 540, cannon: 450,
};

export function pieceValue(piece) { const base = PIECE_VALUES[piece.type] ?? 0; return piece.promoted ? (PROMOTED_VALUES[piece.type] ?? base + 120) : base; }

export function pieceSquareBonus(piece, r, c) {
  const prog = piece.side === SIDE.WHITE ? r : 12 - r;
  let bonus = centerBonus(r, c);
  switch (piece.type) {
    case 'pawn': bonus += prog * 12; if (piece.promoted) bonus += 22;
      if (piece.side === SIDE.WHITE && r >= 7) bonus += 14;
      if (piece.side === SIDE.BLACK && r <= 5) bonus += 14;
      break;
    case 'horse': bonus += (6 - Math.abs(r-6)) * 4; break;
    case 'cannon': bonus += prog * 4; break;
    case 'tower': bonus += prog * 4; break;
    case 'priest': bonus += 16; break;
    case 'archer': bonus += 16; if (onBank(piece.side, r)) bonus += 300; bonus += prog * 10; break;
    case 'king': bonus += isPalaceSquare(r, c, piece.side) ? 90 : -70; break;
    case 'queen': bonus += 35; break;
    case 'general': bonus += 18; break;
    case 'carriage': bonus += 10; break;
    case 'elephant': bonus += 8; break;
    case 'crossbow': bonus += 20; break;
  }
  return bonus;
}

function centerBonus(r, c) { return (12 - Math.abs(r-6) - Math.abs(c-6)) * 3; }

export function seeValue(piece) {
  if (!piece) return 0;
  if (piece.promoted) return PROMOTED_VALUES[piece.type] ?? (PIECE_VALUES[piece.type] ?? 0) + 120;
  return PIECE_VALUES[piece.type] ?? 0;
}

// ── OPT-SEE: findBestAttacker now iterates Uint8Array directly ───────────────
// Old: iterated the Map-compatible wrapper emitting "r,c" string keys,
//      then parsed each key with indexOf(',') + slice + unary plus.
//      Cost: one string allocation + 3 string ops per occupied cell.
// New: iterate byPiece._arr (Uint8Array, 169 entries) with integer arithmetic.
//      Cost: 1 integer divide + 1 modulo per non-zero cell. Zero allocations.
// ES: Iteración directa de Uint8Array — sin strings intermedios ni parsing.
// ─────────────────────────────────────────────────────────────────────────────
function findBestAttacker(board, attackMap, side) {
  let bestVal = Infinity, bestR = -1, bestC = -1, bestPiece = null;
  const arr = attackMap.byPiece._arr;   // Uint8Array(169)
  for (let _i = 0; _i < 169; _i++) {
    if (!arr[_i]) continue;
    const pr = (_i / 13) | 0;
    const pc = _i % 13;
    const p = board[pr]?.[pc];
    if (!p || p.side !== side) continue;
    const v = seeValue(p);
    if (v < bestVal) {
      bestVal = v; bestR = pr; bestC = pc; bestPiece = p;
    }
  }
  if (bestR < 0) return null;
  return { r: bestR, c: bestC, piece: bestPiece, val: bestVal };
}

const seeResult = { value: 0 };

function seeWithMap(board, toR, toC, targetVal, attackerSide, attackMap) {
  const attacker = findBestAttacker(board, attackMap, attackerSide);
  if (!attacker) { seeResult.value = 0; return seeResult; }
  const gain = targetVal;
  board[attacker.r][attacker.c] = null;
  const recapture = seeWithMap(board, toR, toC, seeValue(attacker.piece), opponent(attackerSide), attackMap);
  board[attacker.r][attacker.c] = attacker.piece;
  const v = Math.max(0, gain - recapture.value);
  seeResult.value = v;
  return seeResult;
}

export function isSEEPositive(state, move, buildAttackMap) {
  if (!move || move.fromReserve || !move.to) return true;
  const target = state.board[move.to.r]?.[move.to.c];
  if (!target) return true;
  const piece = state.board[move.from.r]?.[move.from.c];
  if (piece && (piece.type === 'archer' || piece.type === 'cannon')) return true;
  if (state.palaceCurse?.[state.turn]?.active) return true;
  const targetVal = seeValue(target);
  const boardCopy = copyBoard(acquireBoard(), state.board);
  const attackerSide = opponent(state.turn);
  const attackMap = buildAttackMap(boardCopy, attackerSide);
  const recapture = seeWithMap(boardCopy, move.to.r, move.to.c, seeValue(state.board[move.from.r]?.[move.from.c]), attackerSide, attackMap);
  return targetVal - recapture.value >= 0;
}

function normalizeMove(move, promote) {
  if (!move) return null;
  if (move.fromReserve) {
    return { fromReserve: true, reserveIndex: move.reserveIndex, to: { r: move.to.r, c: move.to.c }, promotion: false };
  }
  if (!move.from || !move.to) return null;
  return { from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c }, promotion: Boolean(promote) };
}