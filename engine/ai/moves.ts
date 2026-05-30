// Move handling - TypeScript
import { dbg } from '../debug/debug.ts';
import { SIDE, opponent, isPromotableType, isPalaceSquare, isReserveType } from '../constants.ts';
import { applyMove, isPromotionAvailableForMove } from '../rules/index.ts';
import {
  xorPiece, xorReserves, ZobristTurn, ZobristPalaceWhite, ZobristPalaceBlack,
  SIDE_INDEX, PIECE_INDEX
} from './hashing.ts';
import { applyMoveToMaps, rebuildMaps } from './incremental-attack.ts';
import { pieceValue, pieceSquareBonus, seeValue } from './piece-values.ts';
import { invalidateMaterialCache } from './material-cache.ts';
import type { Board, Piece, GameState, Move, NormalizedMove, MoveData, UndoState, AttackMaps, AttackMapsPair } from '../types.ts';

export { pieceValue, pieceSquareBonus, seeValue };

const BOARD_POOL_SIZE = 64;
let boardPoolIdx = 0;
const boardPool: Board[] = [];

for (let i = 0; i < BOARD_POOL_SIZE; i++) {
  const b: Board = [];
  for (let r = 0; r < 13; r++) b[r] = new Array(13).fill(null);
  boardPool.push(b);
}

function acquireBoard(): Board {
  const b = boardPool[boardPoolIdx];
  boardPoolIdx = (boardPoolIdx + 1) % BOARD_POOL_SIZE;
  return b;
}

function copyBoard(dst: Board, src: Board): Board {
  for (let r = 0; r < 13; r++) {
    const rowDst = dst[r];
    const rowSrc = src[r];
    for (let c = 0; c < 13; c++) rowDst[c] = rowSrc[c];
  }
  return dst;
}

const UNDO_POOL_SIZE = 4096;
let undoPoolIdx = 0;
const undoPool: UndoState[] = [];

for (let i = 0; i < UNDO_POOL_SIZE; i++) {
  undoPool.push({
    cells: new Array(8).fill(null),
    cellCount: 0, turn: null, lastMove: null,
    reservesW: null, reservesB: null,
    reserveRemoved: null, reserveCaptureAdded: false,
    palaceTaken: null, palaceTimers: null, palaceCurse: null,
    history: null, historyLength: 0, positionHistory: null,
    lastRepeatedMoveKey: null, repeatMoveCount: 0,
    archerAmbush: null, selected: null, legalMoves: null,
    promotionRequest: null, message: null, status: null,
    hash: null, eval: null,
  });
}

function acquireUndo(): UndoState {
  const u = undoPool[undoPoolIdx];
  undoPoolIdx = (undoPoolIdx + 1) % UNDO_POOL_SIZE;
  u.cellCount = 0;
  u.turn = null; u.lastMove = null;
  u.reservesW = null; u.reservesB = null;
  u.reserveRemoved = null; u.reserveCaptureAdded = false;
  u.palaceTaken = null; u.palaceTimers = null; u.palaceCurse = null;
  u.history = null; u.historyLength = 0; u.positionHistory = null;
  u.lastRepeatedMoveKey = null; u.repeatMoveCount = 0;
  u.archerAmbush = null; u.selected = null; u.legalMoves = null;
  u.promotionRequest = null; u.message = null; u.status = null;
  u.hash = null; u.eval = null;
  return u;
}

const ARCHER_DC = [-1, 0, 1];

export function isValidMove(move: Move): boolean {
  if (!move || typeof move !== 'object') return false;
  if (move.fromReserve)
    return Number.isInteger(move.reserveIndex) && move.to && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
  return move.from && move.to && Number.isInteger(move.from.r) && Number.isInteger(move.from.c) && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
}

export function makeMove(state: GameState, move: Move, promote: boolean, currentHash: bigint, currentEval: number | null = null, precomputedMaps: AttackMapsPair | null = null): MoveData {
  const t = dbg.perf.start('makeMove');
  if (!isValidMove(move)) {
    dbg.perf.end(t);
    return { action: null, undo: null, hash: currentHash, evalDiff: 0 };
  }
  const from = move.from ?? null, to = move.to ?? null;
  const undo = acquireUndo();
  undo.turn = state.turn;
  undo.lastMove = state.lastMove ? { ...state.lastMove } : null;
  undo.hash = currentHash;
  undo.eval = currentEval;
  const rw = state.reserves.white;
  undo.reserveRemoved = null;
  undo.reserveCaptureAdded = false;
  let hasCapture = false;
  if (move.fromReserve) {
    const entry = rw[(move.reserveIndex ?? 0)];
    undo.reserveRemoved = entry ? { index: move.reserveIndex ?? 0, entry: { ...entry } } : null;
  } else if (to && state.board[to.r]?.[to.c]) {
    hasCapture = true;
  }
  if (hasCapture) invalidateMaterialCache();
  undo.palaceTaken = state.palaceTaken ? { white: state.palaceTaken.white, black: state.palaceTaken.black } : null;
  undo.palaceTimers = state.palaceTimers ? { white: { ...state.palaceTimers.white }, black: { ...state.palaceTimers.black } } : null;
  undo.palaceCurse = state.palaceCurse ? { white: { ...state.palaceCurse.white }, black: { ...state.palaceCurse.black } } : null;
  undo.selected = state.selected ?? null;
  undo.legalMoves = state.legalMoves ? [...state.legalMoves] : null;
  undo.promotionRequest = state.promotionRequest ?? null;
  undo.message = state.message ?? null;
  undo.status = state.status ?? null;
  undo.lastRepeatedMoveKey = state.lastRepeatedMoveKey ?? null;
  undo.repeatMoveCount = state.repeatMoveCount ?? 0;
  undo.cellCount = 0;
  if (!move.fromReserve && from && state.board[from.r]?.[from.c]) {
    const ci = undo.cellCount++;
    undo.cells[ci] = { r: from.r, c: from.c, p: { ...state.board[from.r][from.c]! } };
  }
  if (to) {
    const ci = undo.cellCount++;
    undo.cells[ci] = { r: to.r, c: to.c, p: state.board[to.r]?.[to.c] ? { ...state.board[to.r][to.c]! } : null };
  }
  const action = normalizeMove(move, promote);
  if (!action) { dbg.perf.end(t); return { action: null, undo, hash: currentHash, evalDiff: 0 }; }
  action.silent = true;
  undo.history = state.history ?? null;
  undo.historyLength = state.history?.length ?? 0;
  undo.positionHistory = action.silent ? state.positionHistory : (state.positionHistory instanceof Map ? new Map(state.positionHistory) : state.positionHistory);
  let evalDiff = 0;
  if (currentEval !== null) {
    if (!move.fromReserve && from) {
      const piece = state.board[from.r][from.c];
      if (piece) {
        const target = to ? state.board[to.r]?.[to.c] : null;
        evalDiff -= pieceValue(piece) + pieceSquareBonus(piece, from.r, from.c);
        evalDiff += pieceValue(piece) + pieceSquareBonus(piece, to!.r, to!.c);
        if (target && target.side !== piece.side) evalDiff -= pieceValue(target) + pieceSquareBonus(target, to!.r, to!.c);
        evalDiff *= (piece.side === SIDE.BLACK) ? 1 : -1;
      }
    }
  }
  let newHash = currentHash;
  if (!move.fromReserve && from && state.board[from.r]?.[from.c]) newHash = xorPiece(newHash, from.r, from.c, state.board[from.r][from.c]!);
  if (to && state.board[to.r]?.[to.c]) newHash = xorPiece(newHash, to.r, to.c, state.board[to.r][to.c]!);
  newHash = xorReserves(newHash, state.reserves.white, 0);
  newHash = xorReserves(newHash, state.reserves.black, 1);
  const oldPalH = (state.palaceTaken?.white ? ZobristPalaceWhite : 0n) ^ (state.palaceTaken?.black ? ZobristPalaceBlack : 0n);
  applyMove(state, action as any);
  if (to && state.board[to.r]?.[to.c]) newHash = xorPiece(newHash, to.r, to.c, state.board[to.r][to.c]!);
  newHash = xorReserves(newHash, state.reserves.white, 0);
  newHash = xorReserves(newHash, state.reserves.black, 1);
  const newPalH = (state.palaceTaken?.white ? ZobristPalaceWhite : 0n) ^ (state.palaceTaken?.black ? ZobristPalaceBlack : 0n);
  newHash ^= oldPalH ^ newPalH ^ ZobristTurn[0] ^ ZobristTurn[1];
  if (action.silent) {
    state.history = state.history ?? [];
    state.history.push(newHash);
  }
  dbg.perf.end(t);
  return { action, undo, hash: newHash, evalDiff };
}

export function unmakeMove(state: GameState, { undo }: { undo: UndoState }): void {
  if (!undo) return;
  for (let i = 0; i < undo.cellCount; i++) {
    const cell = undo.cells[i];
    if (cell) state.board[cell.r][cell.c] = cell.p;
  }
  if (undo.reserveRemoved) {
    state.reserves[undo.turn as string].splice(undo.reserveRemoved.index, 0, undo.reserveRemoved.entry);
  }
  if (undo.reserveCaptureAdded) {
    state.reserves[undo.turn as string].pop();
  }
  state.turn = undo.turn!;
  state.lastMove = undo.lastMove;
  if (undo.history === null) state.history = null;
  else if (undo.history !== undefined) {
    state.history = undo.history;
    if (typeof undo.historyLength === 'number') state.history.length = undo.historyLength;
  }
  state.positionHistory = undo.positionHistory;
  state.lastRepeatedMoveKey = undo.lastRepeatedMoveKey;
  state.repeatMoveCount = undo.repeatMoveCount;
  state.selected = undo.selected;
  state.legalMoves = undo.legalMoves;
  state.promotionRequest = undo.promotionRequest;
  state.message = undo.message;
  state.status = undo.status;
  state.palaceTaken = undo.palaceTaken;
  state.palaceTimers = undo.palaceTimers;
  if (undo.palaceCurse) state.palaceCurse = undo.palaceCurse;
}

function findBestAttacker(board: Board, attackMap: { byPiece: { _arr: Uint8Array } }, side: string): { r: number; c: number; piece: Piece; val: number } | null {
  let bestVal = Infinity, bestR = -1, bestC = -1, bestPiece: Piece | null = null;
  const arr = attackMap.byPiece._arr;
  for (let _i = 0; _i < 169; _i++) {
    if (!arr[_i]) continue;
    const pr = (_i / 13) | 0;
    const pc = _i % 13;
    const p = board[pr]?.[pc];
    if (!p || p.side !== side) continue;
    const v = seeValue(p);
    if (v < bestVal) { bestVal = v; bestR = pr; bestC = pc; bestPiece = p; }
  }
  if (bestR < 0) return null;
  return { r: bestR, c: bestC, piece: bestPiece!, val: bestVal };
}

const seeResult = { value: 0 };

function seeWithMap(board: Board, toR: number, toC: number, targetVal: number, attackerSide: string, attackMap: any): { value: number } {
  const attacker = findBestAttacker(board, attackMap, attackerSide);
  if (!attacker) { seeResult.value = 0; return seeResult; }
  const gain = targetVal;
  board[attacker.r][attacker.c] = null;
  const recapture = seeWithMap(board, toR, toC, seeValue(attacker.piece), opponent(attackerSide as any), attackMap);
  board[attacker.r][attacker.c] = attacker.piece;
  seeResult.value = Math.max(0, gain - recapture.value);
  return seeResult;
}

export function isSEEPositive(state: GameState, move: Move, buildAttackMapFn: any): boolean {
  if (!move || move.fromReserve || !move.to) return true;
  const target = state.board[move.to.r]?.[move.to.c];
  if (!target) return true;
  const piece = state.board[move.from!.r]?.[move.from!.c];
  if (piece && (piece.type === 'archer' || piece.type === 'cannon')) return true;
  if (state.palaceCurse?.[state.turn]?.active) return true;
  const targetVal = seeValue(target);
  if (targetVal >= 300) return true;
  if (piece) {
    const pieceVal = seeValue(piece);
    if (targetVal > pieceVal) return true;
  }
  const boardCopy = copyBoard(acquireBoard(), state.board);
  const attackerSide = opponent(state.turn);
  const attackMap = buildAttackMapFn(boardCopy, attackerSide);
  const recapture = seeWithMap(boardCopy, move.to.r, move.to.c, seeValue(state.board[move.from!.r]?.[move.from!.c]!), attackerSide, attackMap);
  return targetVal - recapture.value >= 0;
}

function normalizeMove(move: Move, promote: boolean): NormalizedMove | null {
  if (!move) return null;
  if (move.fromReserve) {
    return { fromReserve: true, reserveIndex: move.reserveIndex, to: { r: move.to!.r, c: move.to!.c }, promotion: false };
  }
  if (!move.from || !move.to) return null;
  return { from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c }, promotion: Boolean(promote) };
}