// ═════════════════════════════════════════════════════
//  Board Utilities (EN/ES)
//  Board creation, piece factory, position hashing, cloning
// ═════════════════════════════════════════════════════

import { BOARD_SIZE, SIDE } from '../constants.js';

// Factory: create a piece with unique ID
//  Crea una pieza con ID único
export function makePiece(type, side, promoted = false) {
  return { id: crypto.randomUUID(), type, side, promoted, locked: false };
}

export function mirrorRow(row) {
  return BOARD_SIZE - 1 - row;
}

// Initial board layout following traditional placement
//  Disposición inicial siguiendo la colocación tradicional
export function initialLayout() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

  const topBack = ["tower", "cannon", "horse", "priest", "elephant", "general", "king", "queen", "elephant", "priest", "horse", "cannon", "tower"];
  const topMid = [null, "carriage", null, null, null, null, "archer", null, null, null, null, "carriage", null];
  const topPawn = Array(BOARD_SIZE).fill("pawn");

  for (let c = 0; c < BOARD_SIZE; c++) {
    board[0][c] = makePiece(topBack[c], SIDE.BLACK);
    if (topMid[c]) board[1][c] = makePiece(topMid[c], SIDE.BLACK);
    board[2][c] = makePiece(topPawn[c], SIDE.BLACK);
  }

  const bottomBack = [...topBack].reverse();
  const bottomMid = [...topMid].reverse();
  const bottomPawn = Array(BOARD_SIZE).fill("pawn");

  for (let c = 0; c < BOARD_SIZE; c++) {
    board[12][c] = makePiece(bottomBack[c], SIDE.WHITE);
    if (bottomMid[c]) board[11][c] = makePiece(bottomMid[c], SIDE.WHITE);
    board[10][c] = makePiece(bottomPawn[c], SIDE.WHITE);
  }

  return board;
}

export function insideOwnPalaceRow(side, row) {
  return side === SIDE.BLACK ? row >= 0 && row <= 2 : row >= 10 && row <= 12;
}

export function sameSide(piece, target) {
  return target && piece && target.side === piece.side;
}

// Ray-clear check: no pieces between two squares on a straight/diagonal line
//  Verifica si no hay piezas entre dos casillas en línea recta/diagonal
export function lineClear(board, r1, c1, r2, c2) {
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  let r = r1 + dr;
  let c = c1 + dc;
  while (r !== r2 || c !== c2) {
    if (board[r][c]) return false;
    r += dr;
    c += dc;
  }
  return true;
}

// Count pieces between two squares (used for cannon jump mechanics)
//  Cuenta piezas entre dos casillas (para mecánica de salto del cañón)
export function countBetween(board, r1, c1, r2, c2) {
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  let r = r1 + dr;
  let c = c1 + dc;
  let count = 0;
  while (r !== r2 || c !== c2) {
    if (board[r][c]) count++;
    r += dr;
    c += dc;
  }
  return count;
}

// Enumerate all squares between (r1,c1) and (r2,c2), exclusive
//  Enumera todas las casillas entre dos posiciones (excluyendo extremos)
export function pathSquares(r1, c1, r2, c2) {
  const out = [];
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  let r = r1 + dr;
  let c = c1 + dc;
  while (r !== r2 || c !== c2) {
    out.push([r, c]);
    r += dr;
    c += dc;
  }
  return out;
}

export function pathIsClear(board, r1, c1, r2, c2) {
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  let r = r1 + dr;
  let c = c1 + dc;
  while (r !== r2 || c !== c2) {
    if (board[r][c]) return false;
    r += dr;
    c += dc;
  }
  return true;
}

// Find both kings on the board (returns { white: {r,c}, black: {r,c} })
//  Encuentra ambos reyes en el tablero
export function findKings(board) {
  const out = {};
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (p && p.type === "king") out[p.side] = { r, c, piece: p };
    }
  }
  return out;
}

export function isEnemy(pieceA, pieceB) {
  return pieceA && pieceB && pieceA.side !== pieceB.side;
}

// Position signature string: compact board+turn+reserves encoding (for repetition detection)
//  Firma de posición: codificación compacta tablero+turno+reservas (para detección de repetición)
export function boardSignature(state) {
  let str = "";

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = state.board[r][c];
      if (!p) {
        str += ".";
      } else {
        str += `${p.type[0]}${p.side[0]}${p.promoted ? "1" : "0"}`;
      }
    }
  }

  str += "|t:" + state.turn;

  const whiteRes = state.reserves.white.map(p => p.type).sort().join(",");
  const blackRes = state.reserves.black.map(p => p.type).sort().join(",");

  str += "|rw:" + whiteRes;
  str += "|rb:" + blackRes;

  return str;
}

// Deep clone the entire game state (for search simulation)
//  Clon profundo del estado completo del juego (para simulación en búsqueda)
export function cloneState(state) {
  const board = new Array(BOARD_SIZE);
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = state.board[r].slice();
  }
  
  return {
    board,
    turn: state.turn,
    selected: null,
    legalMoves: [],
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id, locked: p.locked ?? false })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id, locked: p.locked ?? false })),
    },
    promotionRequest: null,
    status: state.status,
    message: '',
    palaceTimers: {
      white: { ...state.palaceTimers?.white ?? { pressure: 0, invaded: false, attackerSide: null } },
      black: { ...state.palaceTimers?.black ?? { pressure: 0, invaded: false, attackerSide: null } },
    },
    palaceTaken: {
      white: state.palaceTaken?.white ?? false,
      black: state.palaceTaken?.black ?? false,
    },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount: state.repeatMoveCount ?? 0,
    positionHistory: state.positionHistory instanceof Map
      ? new Map(state.positionHistory)
      : new Map(),
    history: state.history ? [...state.history] : [],
    archerAmbush: null,
  };
}