import { BOARD_SIZE, SIDE, opponent, isPalaceSquare, onBank, forwardDir, homePromotionZone, canDropOnSide, isPromotableType, isReserveType, pieceLabel, isRiverSquare } from "../constants.js";
import { makePiece, findKings, boardSignature, cloneState } from './board.js';
import { createGame, resetGame } from './game.js';
export { createGame, resetGame };
import { isSquareProtectedByArcher, getArcherAmbushResult, executeArcherAmbush, getArcherBlockedSquares } from './archer.js';
export { isSquareProtectedByArcher, getArcherAmbushResult, executeArcherAmbush, getArcherBlockedSquares };
import { isKingInCheck, isSquareAttacked, attackSquaresForPiece } from './check.js';
export { isKingInCheck, isSquareAttacked, attackSquaresForPiece };
import { getLegalMovesForSquare, pseudoMovesForPiece, rayMoves, jumpMoves, addIfValid } from './moves.js';
export { getLegalMovesForSquare, pseudoMovesForPiece, rayMoves, jumpMoves, addIfValid };
import { updatePalaceState, isPalaceCursedFor, getPalaceInvaders } from './state.js';
export { isPalaceCursedFor, getPalaceInvaders };

function captureToReserve(state, captured, captorSide) {
  if (!captured) return;
  const type = captured.promoted ? (captured.type === "pawn" ? "crossbow" : captured.type) : captured.type;
  if (!isReserveType(type)) return;
  state.reserves[captorSide].push({ id: crypto.randomUUID(), type, side: captorSide });
}

function maybePromote(state, piece, r, c) {
  if (!piece || !isPromotableType(piece.type) || piece.promoted) return false;
  if (!homePromotionZone(piece.side, r)) return false;
  return true;
}

function applyPromotion(piece) { piece.promoted = true; }

function moveSignature(action, side) {
  if (!action) return null;
  if (action.fromReserve) return `drop:${side}:${action.reserveIndex}->${action.to.r},${action.to.c}:${action.promotion ? 1 : 0}`;
  return `move:${side}:${action.from.r},${action.from.c}->${action.to.r},${action.to.c}:${action.promotion ? 1 : 0}`;
}

function buildStatusMessage(state) {
  return isKingInCheck(state, state.turn)
    ? `${state.turn === SIDE.WHITE ? "Blanco" : "Negro"} está en jaque.`
    : `${state.turn === SIDE.WHITE ? "Blanco" : "Negro"} al turno.`;
}

export function applyMove(state, action) {
  if (!(state.positionHistory instanceof Map)) {
    state.positionHistory = new Map(Object.entries(state.positionHistory || {}));
  }
  state.archerAmbush = null;
  const { from, to, fromReserve = false, reserveIndex = null, silent = false, promotion = false } = action;
  const board = state.board;
  let movingPiece = null;
  const currentMoveKey = moveSignature(action, state.turn);
  if (state.lastRepeatedMoveKey === currentMoveKey) {
    state.repeatMoveCount = (state.repeatMoveCount || 1) + 1;
  } else {
    state.repeatMoveCount = 1;
    state.lastRepeatedMoveKey = currentMoveKey;
  }
  if (fromReserve) {
    const dropped = state.reserves[state.turn].splice(reserveIndex, 1)[0];
    movingPiece = makePiece(dropped.type, state.turn, false);
    board[to.r][to.c] = movingPiece;
    state.lastMove = { drop: true, piece: movingPiece.type, to };
  } else {
    movingPiece = board[from.r][from.c];
    const target = board[to.r][to.c];
    if (target && target.side !== movingPiece.side) captureToReserve(state, target, movingPiece.side);
    board[to.r][to.c] = movingPiece;
    board[from.r][from.c] = null;
    state.lastMove = { from, to, piece: movingPiece.type };
  }
  if (maybePromote(state, movingPiece, to.r, to.c) && promotion) applyPromotion(movingPiece);
  updatePalaceState(state);
  state.turn = opponent(state.turn);
  state.selected = null;
  state.legalMoves = [];
  state.promotionRequest = null;
  if (!silent) state.message = buildStatusMessage(state);
  const key = boardSignature(state);
  if (!silent && movingPiece.type === "archer" && onBank(movingPiece.side, to.r) && !fromReserve) {
    const ambushResult = getArcherAmbushResult(state, movingPiece, to);
    if (ambushResult) state.archerAmbush = ambushResult;
  }
  if (!silent) {
    state.positionHistory.set(key, (state.positionHistory.get(key) || 0) + 1);
  }
  return state;
}

function isInPalaceMate(state, side) {
  const kings = findKings(state.board);
  const king = kings[side];
  if (!king || !isPalaceSquare(king.r, king.c, side)) return false;
  const enemy = opponent(side);
  let enemyInside = false;
  for (let r = 0; r < BOARD_SIZE && !enemyInside; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c]?.side === enemy && isPalaceSquare(r, c, side)) { enemyInside = true; break; }
    }
  }
  if (!enemyInside) return false;
  const kingMoves = getLegalMovesForSquare(state, king.r, king.c);
  if (kingMoves.some(m => !isPalaceSquare(m.r, m.c, side))) return false;
  const allDefenseMoves = getAllLegalMoves(state, side);
  if (allDefenseMoves.some(m => {
    const t = state.board[m.to.r][m.to.c];
    return t && t.side === enemy && isPalaceSquare(m.to.r, m.to.c, side);
  })) return false;
  return true;
}

export function getAllLegalMoves(state, side) {
  const board = state.board;
  const all = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (p && p.side === side) {
        const moves = getLegalMovesForSquare(state, r, c);
        for (const m of moves) all.push({ from: { r, c }, to: { r: m.r, c: m.c } });
      }
    }
  }
  for (const drop of getLegalReserveDrops(state, side)) all.push(drop);
  return all;
}

export function getLegalReserveDrops(state, side) {
  const out = [];
  const reserve = state.reserves[side];
  for (let i = 0; i < reserve.length; i++) {
    const type = reserve[i].type;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]) continue;
        if (type !== 'crossbow' && !canDropOnSide(type, side, r)) continue;
        const tempPiece = { id: '_tmp', type, side, promoted: false, locked: false };
        state.board[r][c] = tempPiece;
        const removed = state.reserves[side].splice(i, 1)[0];
        const legal = !isKingInCheck(state, side);
        state.board[r][c] = null;
        state.reserves[side].splice(i, 0, removed);
        if (legal) out.push({ fromReserve: true, reserveIndex: i, to: { r, c }, type, promotion: false });
      }
    }
  }
  return out;
}

export function isPromotionAvailableForMove(state, from, to) {
  const piece = state.board[from.r][from.c];
  if (!piece || !isPromotableType(piece.type) || piece.promoted) return false;
  return homePromotionZone(piece.side, to.r);
}

export function moveWouldPromote(state, from, to) { return isPromotionAvailableForMove(state, from, to); }

export function isDropLegal(state, side, reserveIndex, to) {
  const entry = state.reserves[side][reserveIndex];
  if (!entry || state.board[to.r][to.c] || isRiverSquare(to.r)) return false;
  if (entry.type !== "crossbow" && !canDropOnSide(entry.type, side, to.r)) return false;
  if (isSquareProtectedByArcher(state, to.r, to.c, opponent(side))) return false;
  const trial = cloneState(state);
  trial.board[to.r][to.c] = makePiece(entry.type, side, false);
  trial.reserves[side].splice(reserveIndex, 1);
  return !isKingInCheck(trial, side);
}

export function executeDrop(state, reserveIndex, to) {
  const entry = state.reserves[state.turn][reserveIndex];
  if (!entry || !isDropLegal(state, state.turn, reserveIndex, to)) return false;
  state.board[to.r][to.c] = makePiece(entry.type, state.turn, false);
  state.reserves[state.turn].splice(reserveIndex, 1);
  updatePalaceState(state);
  state.turn = opponent(state.turn);
  state.selected = null;
  state.legalMoves = [];
  state.promotionRequest = null;
  state.message = buildStatusMessage(state);
  // Register position for repetition detection
  const key = boardSignature(state);
  state.positionHistory.set(key, (state.positionHistory.get(key) || 0) + 1);
  return true;
}

export function afterMoveEvaluation(state) {
  try {
    const side = state.turn;
    const key = boardSignature(state);
    if (state.positionHistory.get(key) >= 3) { state.status = "draw"; state.message = "Tablas por repetición de posición (3 veces)."; return; }
    const legal = getAllLegalMoves(state, side);
    const inCheck = isKingInCheck(state, side);
    if (legal.length === 0) {
      state.status = inCheck ? "checkmate" : "stalemate";
      state.message = inCheck ? `${side === SIDE.WHITE ? "Blanco" : "Negro"} pierde por jaque mate.` : "Ahogado / tablas por falta de movimientos.";
    } else {
      state.status = "playing";
      if (isInPalaceMate(state, side)) {
        state.status = "palacemate";
        state.message = `${side === SIDE.WHITE ? "Blanco" : "Negro"} cae por mate por captura (asedio total).`;
      }
    }
    if (state.status === "playing") {
      for (const s of [SIDE.WHITE, SIDE.BLACK]) {
        if (state.palaceTaken?.[s]) {
          const king = findKings(state.board)[s];
          if (king && isPalaceSquare(king.r, king.c, s)) state.message = `${s === SIDE.WHITE ? "Blanco" : "Negro"} tiene el palacio tomado.`;
        }
      }
    }
  } catch (err) {
    console.error("[afterMoveEvaluation] Error:", err);
    state.status = "playing";
    state.message = buildStatusMessage(state);
  }
  return state;
}

export function getPieceMoves(state, r, c) { return getLegalMovesForSquare(state, r, c); }
export function getReserveEntries(state, side) { return state.reserves[side]; }
export function getBoardMeta() { return { size: BOARD_SIZE, riverRows: [6], palaceCols: [5, 7] }; }
export function getPieceText(piece) { return pieceLabel(piece); }
