import { dbg } from '../debug.js';
import { SIDE, opponent, isPromotableType, isPalaceSquare, onBank } from '../constants.js';
import { applyMove, isPromotionAvailableForMove } from '../rules/index.js';
import {
  xorPiece, xorReserves, ZobristTurn, ZobristPalaceWhite, ZobristPalaceBlack,
  SIDE_INDEX, PIECE_INDEX
} from './hashing.js';

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
  const undo = {
    cells: [], turn: state.turn, lastMove: state.lastMove ? { ...state.lastMove } : null,
    reservesW: state.reserves.white.map(p => ({ ...p })), reservesB: state.reserves.black.map(p => ({ ...p })),
    palaceTaken:  { ...(state.palaceTaken  ?? { white: false, black: false }) },
    palaceTimers: { white: { ...(state.palaceTimers?.white ?? {}) }, black: { ...(state.palaceTimers?.black ?? {}) } },
    palaceCurse: state.palaceCurse ? { white: {...state.palaceCurse.white}, black: {...state.palaceCurse.black} } : null,
    history: state.history ? [...state.history] : [],
    hash: currentHash, eval: currentEval,
  };
  if (!move.fromReserve && from && state.board[from.r]?.[from.c]) undo.cells.push({ r: from.r, c: from.c, p: { ...state.board[from.r][from.c] } });
  if (to) undo.cells.push({ r: to.r, c: to.c, p: state.board[to.r]?.[to.c] ? { ...state.board[to.r][to.c] } : null });
  const action = normalizeMove(move, promote);
  if (!action) return { action: null, undo, hash: currentHash, evalDiff: 0 };

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
    const f = state.turn === SIDE.WHITE ? 1 : -1;  // blanco avanza +r, negro -r
    for (const dc of [-1,0,1]) {
      const nr = to.r + f, nc = to.c + dc;
      if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) undo.cells.push({ r: nr, c: nc, p: state.board[nr][nc] ? { ...state.board[nr][nc] } : null });
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
  for (const { r, c, p } of undo.cells) state.board[r][c] = p;
  state.turn = undo.turn; state.lastMove = undo.lastMove; state.history = undo.history;
  state.palaceTaken = undo.palaceTaken; state.palaceTimers = undo.palaceTimers;
  state.reserves.white = undo.reservesW; state.reserves.black = undo.reservesB;
  if (undo.palaceCurse) state.palaceCurse = undo.palaceCurse;
}

const PIECE_VALUES = {
  king: 0, queen: 950, general: 560, elephant: 240, priest: 400,
  horse: 320, cannon: 450, tower: 520, carriage: 390, archer: 450,
  pawn: 110, crossbow: 240,
};
const PROMOTED_VALUES = {
  pawn: 240, tower: 650, horse: 430, elephant: 320, priest: 540, cannon: 540,
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

function getAttackers(board, attackMap, r, c, side) {
  const key = `${r},${c}`;
  const attackers = [];
  for (const [pos, val] of attackMap.byPiece) {
    if (val <= 0) continue;
    const [pr, pc] = pos.split(',').map(Number);
    if (board[pr]?.[pc]?.side === side) attackers.push({ r: pr, c: pc, piece: board[pr][pc] });
  }
  return attackers.sort((a, b) => seeValue(a.piece) - seeValue(b.piece));
}

function seeWithMap(board, toR, toC, targetVal, attackerSide, attackMap) {
  const attackers = getAttackers(board, attackMap, toR, toC, attackerSide);
  if (attackers.length === 0) return 0;
  const attacker = attackers[0];
  const gain = targetVal;
  board[attacker.r][attacker.c] = null;
  const recapture = seeWithMap(board, toR, toC, seeValue(attacker.piece), opponent(attackerSide), attackMap);
  board[attacker.r][attacker.c] = attacker.piece;
  return Math.max(0, gain - recapture);
}

export function isSEEPositive(state, move, buildAttackMap) {
  if (!move || move.fromReserve || !move.to) return true;
  const target = state.board[move.to.r]?.[move.to.c];
  if (!target) return true;
  const piece = state.board[move.from.r]?.[move.from.c];
  if (piece && (piece.type === 'archer' || piece.type === 'cannon')) return true;
  if (state.palaceCurse?.[state.turn]?.active) return true;
  const targetVal = seeValue(target);
  const boardCopy = state.board.map(row => [...row]);
  const attackerSide = opponent(state.turn);
  const attackMap = buildAttackMap(boardCopy, attackerSide);
  const recapture = seeWithMap(boardCopy, move.to.r, move.to.c, seeValue(state.board[move.from.r]?.[move.from.c]), attackerSide, attackMap);
  return targetVal - recapture >= 0;
}

function normalizeMove(move, promote) {
  if (!move) return null;
  if (move.fromReserve) return { fromReserve: true, reserveIndex: move.reserveIndex, to: { ...move.to }, promotion: false };
  if (!move.from || !move.to) return null;
  return { from: { ...move.from }, to: { ...move.to }, promotion: Boolean(promote) };
}
