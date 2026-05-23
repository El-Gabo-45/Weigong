import { BOARD_SIZE, SIDE } from "../../engine/constants.js";
import {
  encodeBoardForNN,
} from "./analysis-panel.js";
import { computeFullHash, extractFeatures, moveKey, moveKeyUint32 } from "../../engine/ai/index.js";

// ── TypedArray-optimized board snapshot (internal) ──
// ES: Snapshot optimizado con TypedArray (uso interno)
// When saving to JSON, convert back to the original {t, promoted} | null format.
// ES: Al guardar a JSON, se convierte de vuelta al formato original {t, promoted} | null.
// Map each piece type to a unique numeric index for internal use
// ES: Mapea cada tipo de pieza a un índice numérico único para uso interno
const PIECE_TYPE_MAP = { king:0, queen:1, general:2, elephant:3, priest:4, horse:5, cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11 };
// When converting back to JSON, use p.type[0] (first char) just like the original boardSnapshot did
// ES: Al convertir de vuelta a JSON, usa p.type[0] (primer caracter) como el boardSnapshot original
const TYPE_FIRST_CHAR_BY_IDX = ['k','q','g','e','p','h','c','t','c','a','p','c'];

function boardSnapshot(board) {
  const snap = new Int16Array(BOARD_SIZE * BOARD_SIZE);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (!p) { snap[r * BOARD_SIZE + c] = 0; continue; }
      const typeIdx = PIECE_TYPE_MAP[p.type] ?? 13;
      const sideIdx = p.side === SIDE.WHITE ? 0 : 1;
      const prom    = p.promoted ? 1 : 0;
      // Encode: hasPiece(1 bit) | typeIdx(4 bits)*2 | sideIdx(1 bit)*32 | prom(1 bit)*64
      // ES: Codifica: hasPiece(1 bit) | typeIdx(4 bits)*2 | sideIdx(1 bit)*32 | prom(1 bit)*64
      snap[r * BOARD_SIZE + c] = 1 | (typeIdx << 1) | (sideIdx << 5) | (prom << 6);
    }
  }
  return snap;
}

function boardSnapshotToJSON(snap) {
  const result = new Array(snap.length);
  for (let i = 0; i < snap.length; i++) {
    const v = snap[i];
    if (v === 0) { result[i] = null; continue; }
    const typeIdx = (v >> 1) & 0xF;
    const sideIdx = (v >> 5) & 1;
    const prom    = (v >> 6) & 1;
    const typeChar = (typeIdx < TYPE_FIRST_CHAR_BY_IDX.length) ? TYPE_FIRST_CHAR_BY_IDX[typeIdx] : '?';
    const sideChar = sideIdx === 0 ? 'w' : 'b';
    result[i] = { t: typeChar + sideChar, promoted: prom };
  }
  return result;
}

function serializeState(state) {
  return {
    board: state.board.map(row => row.map(p => p ? { type: p.type, side: p.side, promoted: p.promoted, locked: p.locked ?? false, id: p.id } : null)),
    turn: state.turn,
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, locked: p.locked ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, locked: p.locked ?? false, id: p.id })),
    },
    palaceTaken: { white: state.palaceTaken.white, black: state.palaceTaken.black },
    palaceTimers: { white: { ...state.palaceTimers.white }, black: { ...state.palaceTimers.black } },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    history: state.history ? [...state.history] : [],
    positionHistory: [...(state.positionHistory?.entries() ?? [])],
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount: state.repeatMoveCount ?? 0,
    status: state.status,
  };
}

function buildMoveData(side, move, notation, evalBefore, evalResult, stateAfter) {
  const { score: evalAfter, metrics } = evalResult;
  const featureKey = extractFeatures(stateAfter, side);
  const positionHash = computeFullHash(stateAfter).toString();
  const nnEncoding = encodeBoardForNN(stateAfter.board);
  const snap = boardSnapshot(stateAfter.board);
  const stateAfterSerial = serializeState(stateAfter);
  return {
    side,
    moveKeyStr: moveKey(move, move.promotion ?? false),
    moveKeyUint32: moveKeyUint32(move, move.promotion ?? false),
    featureKey,
    evalBefore,
    evalAfter,
    notation: notation ?? '',
    metrics,
    positionHash,
    _nnFloat32: nnEncoding,
    boardSnapshot: snap,
    stateAfter: stateAfterSerial,
  };
}

export { boardSnapshot, boardSnapshotToJSON, serializeState, buildMoveData };