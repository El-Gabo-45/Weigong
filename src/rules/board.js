import { BOARD_SIZE, SIDE, clone } from '../constants.js';

export function makePiece(type, side, promoted = false) {
  return {
    id: crypto.randomUUID(),
    type,
    side,
    promoted,
    locked: false,
  };
}

export function mirrorRow(row) {
  return BOARD_SIZE - 1 - row;
}

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

  const bottomBack = clone(topBack).reverse();
  const bottomMid = clone(topMid).reverse();
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
