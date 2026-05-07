import { BOARD_SIZE, SIDE, onBank, forwardDir, opponent, inBounds } from '../constants.js';

export function getArcherBlockedSquares(archerRow, archerCol, archerSide) {
  if (!onBank(archerSide, archerRow)) return [];
  const front = forwardDir(archerSide);
  const blockRow = archerRow + 2 * front;
  const blocked = [[blockRow, archerCol - 1], [blockRow, archerCol], [blockRow, archerCol + 1]];
  return blocked.filter(([r, c]) => inBounds(r, c));
}

export function isSquareProtectedByArcher(state, targetRow, targetCol, protectorSide) {
  const board = state.board ? state.board : state;
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (!board[r]) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (!p || p.type !== "archer" || p.side !== protectorSide) continue;
      for (const sq of getArcherBlockedSquares(r, c, protectorSide)) {
        const br = Array.isArray(sq) ? sq[0] : sq.r;
        const bc = Array.isArray(sq) ? sq[1] : sq.c;
        if (br === targetRow && bc === targetCol) return true;
      }
    }
  }
  return false;
}

export function getArcherAmbushResult(state, archer, bankPos) {
  const enemy = opponent(archer.side);
  const front = forwardDir(archer.side);
  const blockSquares = getArcherBlockedSquares(bankPos.r, bankPos.c, archer.side);
  const victims = [];
  for (const [r, c] of blockSquares) {
    const p = state.board[r][c];
    if (p && p.side === enemy) {
      const retreatR = r + front;
      const retreatC = c;
      const canRetreat = inBounds(retreatR, retreatC) && !state.board[retreatR][retreatC];
      victims.push({ r, c, p, canRetreat });
    }
  }
  if (!victims.length) return null;
  const cannotRetreat = victims.filter(v => !v.canRetreat);
  if (cannotRetreat.length === victims.length) return { type: 'autoCaptureAll', victims: victims.map(v => ({ r: v.r, c: v.c })), victimPieces: victims.map(v => ({ ...v.p })), archerTo: bankPos };
  if (victims.length === 1) return { type: 'singleCapture', victim: { r: victims[0].r, c: victims[0].c }, victimPiece: { ...victims[0].p }, archerTo: bankPos };
  return { type: 'chooseCapture', options: victims.map(v => ({ r: v.r, c: v.c, piece: v.p, canRetreat: v.canRetreat })), archerTo: bankPos };
}

export function executeArcherAmbush(state, choice) {
  const { archerTo, chosenIndex } = choice;
  const archer = state.board[archerTo.r][archerTo.c];
  if (!archer || archer.type !== 'archer') return;
  const enemy = opponent(archer.side);
  const front = forwardDir(archer.side);
  const blockSquares = getArcherBlockedSquares(archerTo.r, archerTo.c, archer.side);
  const victims = [];
  for (const [r, c] of blockSquares) {
    const p = state.board[r][c];
    if (p && p.side === enemy) {
      const retreatR = r + front, retreatC = c;
      const canRetreat = inBounds(retreatR, retreatC) && !state.board[retreatR][retreatC];
      victims.push({ r, c, p, canRetreat });
    }
  }
  if (!victims.length) return;
  if (victims.length === 1) {
    captureToReserve(state, victims[0].p, archer.side);
    state.board[victims[0].r][victims[0].c] = null;
  } else {
    const chosen = victims[chosenIndex];
    captureToReserve(state, chosen.p, archer.side);
    state.board[chosen.r][chosen.c] = null;
    for (const v of victims) {
      if (v === chosen) continue;
      if (v.canRetreat) { state.board[v.r + front][v.c] = v.p; state.board[v.r][v.c] = null; }
      else { captureToReserve(state, v.p, archer.side); state.board[v.r][v.c] = null; }
    }
  }
}

function captureToReserve(state, captured, captorSide) {
  if (!captured) return;
  const type = captured.promoted ? (captured.type === "pawn" ? "crossbow" : captured.type) : captured.type;
  if (!['tower','general','pawn','crossbow'].includes(type)) return;
  state.reserves[captorSide].push({ id: crypto.randomUUID(), type, side: captorSide });
}
