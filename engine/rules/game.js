// ═════════════════════════════════════════════════════
//  Game State Factory (EN/ES)
// ES: Game State Factory (EN/ES)
//  createGame and resetGame - initializes/resets a full game state
// ES: createGame and resetGame - initializes/resets a full game state
// ═════════════════════════════════════════════════════

import { SIDE, BOARD_SIZE } from '../constants.js';
import { initialLayout, boardSignature, findKings } from './board.js';

// Create a fresh game state with initial board layout
// Crea un estado de juego nuevo con la disposición inicial del tablero
export function createGame() {
  const state = {
    positionHistory: new Map(),
    board: initialLayout(),
    turn: SIDE.WHITE,
    selected: null,
    legalMoves: [],
    reserves: { white: [], black: [] },
    promotionRequest: null,
    status: "playing",
    message: "Partida lista.",
    palaceTimers: {
      white: { pressure: 0, invaded: false, attackerSide: null },
      black: { pressure: 0, invaded: false, attackerSide: null },
    },
    palaceTaken: { white: false, black: false },
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

// Reset an existing state to a fresh game (for replay)
// Reinicia un estado existente a un juego nuevo (para repetición)
export function resetGame(state) {
  const fresh = createGame();
  Object.assign(state, fresh);
  return state;
}