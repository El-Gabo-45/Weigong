import { BOARD_SIZE, SIDE, isPalaceSquare, opponent } from '../constants.js';

export function isPalaceCursedFor(state, side) {
  if (!state.palaceCurse) return false;
  return state.palaceCurse[side]?.active === true;
}

// Returns the piece symbols of enemy pieces currently inside the palace
export function getPalaceInvaders(state, side) {
  if (!state.board) return [];
  const enemy = opponent(side);
  const invaders = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = state.board[r][c];
      if (p && p.side === enemy && isPalaceSquare(r, c, side)) {
        invaders.push({ type: p.type, r, c });
      }
    }
  }
  return invaders;
}

export function updatePalaceState(state) {
  if (!state.palaceCurse) {
    state.palaceCurse = { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } };
  }
  // Reset justActivated flags at start of each call (new turn)
  state.palaceCurse.white.justActivated = false;
  state.palaceCurse.black.justActivated = false;
  state.palaceCurse.white.curseActivators = null;
  state.palaceCurse.black.curseActivators = null;

  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const enemy = opponent(side);
    const enemyInPalace = [];
    let hasKing = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        if (p.side === side && p.type === "king" && isPalaceSquare(r, c, side)) hasKing = true;
        else if (p.side === enemy && isPalaceSquare(r, c, side)) enemyInPalace.push({ r, c, p });
      }
    }
    if (enemyInPalace.length) {
      state.palaceTimers[side].invaded = true;
      state.palaceTimers[side].attackerSide = enemy;
      state.palaceTimers[side].pressure += 1;
      if (state.palaceTimers[side].pressure >= 3) state.palaceTaken[side] = true;
      state.palaceCurse[side].turnsInPalace += 1;
      // Check if curse JUST became active this turn
      const wasActive = state.palaceCurse[side].active;
      if (state.palaceCurse[side].turnsInPalace >= 3) {
        state.palaceCurse[side].active = true;
        if (!wasActive) {
          state.palaceCurse[side].justActivated = true;
          // Store which enemy pieces are in the palace as the activators
          const invaderInfo = enemyInPalace.map(({ r, c, p }) => ({
            type: p.type, r, c, promoted: p.promoted ?? false
          }));
          state.palaceCurse[side].curseActivators = invaderInfo;
        }
      }
    } else {
      state.palaceTimers[side].invaded = false;
      state.palaceTimers[side].attackerSide = null;
      state.palaceTimers[side].pressure = 0;
      state.palaceTaken[side] = false;
      state.palaceCurse[side].turnsInPalace = 0;
      state.palaceCurse[side].active = false;
    }
  }
}
