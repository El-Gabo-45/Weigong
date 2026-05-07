import { SIDE, BOARD_SIZE } from '../constants.js';
import { initialLayout, boardSignature, findKings } from './board.js';

export function createGame() {
  const state = {
    positionHistory: new Map(),
    board: initialLayout(),
    turn: SIDE.WHITE,
    selected: null,
    legalMoves: [],
    reserves: {
      white: [],
      black: [],
    },
    promotionRequest: null,
    status: "playing",
    message: "Partida lista.",
    palaceTimers: {
      white: { pressure: 0, invaded: false, attackerSide: null },
      black: { pressure: 0, invaded: false, attackerSide: null },
    },
    palaceTaken: {
      white: false,
      black: false,
    },
    palaceCurse: {
      white: { active: false, turnsInPalace: 0 },
      black: { active: false, turnsInPalace: 0 },
    },
    lastMove: null,
    lastRepeatedMoveKey: null,
    repeatMoveCount: 0,
  };

  const key = boardSignature(state);
  state.positionHistory.set(key, 1);

  return state;
}

export function resetGame(state) {
  const fresh = createGame();
  Object.assign(state, fresh);
  return state;
}

export function getBoardMeta() {
  const RIVER_ROW = 6;
  const PALACE_COL_START = 5;
  const PALACE_COL_END = 7;
  return {
    size: BOARD_SIZE,
    riverRows: [RIVER_ROW],
    palaceCols: [PALACE_COL_START, PALACE_COL_END],
  };
}
