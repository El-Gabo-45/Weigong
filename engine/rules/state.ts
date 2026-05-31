// ═════════════════════════════════════════════════════
//  Palace State Utilities (EN/ES)
// ES: Palace State Utilities (EN/ES)
// ═════════════════════════════════════════════════════

import { BOARD_SIZE, SIDE, isPalaceSquare, opponent } from '../constants.js';
import type { GameState, Side, Piece } from '../types.js';

export function isPalaceCursedFor(state: GameState, side: Side): boolean {
  if (!state.palaceCurse) return false;
  return state.palaceCurse[side]?.active === true;
}

export interface PalaceInvader {
  type: string;
  r: number;
  c: number;
}

// Returns the piece symbols of enemy pieces currently inside the palace
// ES: Devuelve los símbolos de piezas enemigas actualmente dentro del palacio
export function getPalaceInvaders(state: GameState, side: Side): PalaceInvader[] {
  if (!state.board) return [];
  const enemy = opponent(side);
  const invaders: PalaceInvader[] = [];
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

export function updatePalaceState(state: GameState): void {
  if (!state.palaceCurse) {
    state.palaceCurse = { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } };
  }
  // Reset justActivated flags at start of each call (new turn)
  // ES: Reinicia banderas justActivated al inicio de cada llamada (nuevo turno)
  (state.palaceCurse.white as any).justActivated = false;
  (state.palaceCurse.black as any).justActivated = false;
  (state.palaceCurse.white as any).curseActivators = null;
  (state.palaceCurse.black as any).curseActivators = null;

  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const enemy = opponent(side);
    const enemyInPalace: { r: number; c: number; p: Piece }[] = [];
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
      (state.palaceTimers[side] as any).invaded = true;
      (state.palaceTimers[side] as any).attackerSide = enemy;
      (state.palaceTimers[side] as any).pressure = ((state.palaceTimers[side] as any).pressure ?? 0) + 1;
      if ((state.palaceTimers[side] as any).pressure >= 3) state.palaceTaken[side] = true;
      (state.palaceCurse[side] as any).turnsInPalace = ((state.palaceCurse[side] as any).turnsInPalace ?? 0) + 1;
      // Check if curse JUST became active this turn
      const wasActive = state.palaceCurse[side].active;
      if ((state.palaceCurse[side] as any).turnsInPalace >= 3) {
        state.palaceCurse[side].active = true;
        if (!wasActive) {
          (state.palaceCurse[side] as any).justActivated = true;
          const invaderInfo = enemyInPalace.map(({ r, c, p }) => ({
            type: p.type, r, c, promoted: p.promoted ?? false
          }));
          (state.palaceCurse[side] as any).curseActivators = invaderInfo;
        }
      }
    } else {
      (state.palaceTimers[side] as any).invaded = false;
      (state.palaceTimers[side] as any).attackerSide = null;
      (state.palaceTimers[side] as any).pressure = 0;
      state.palaceTaken[side] = false;
      (state.palaceCurse[side] as any).turnsInPalace = 0;
      state.palaceCurse[side].active = false;
    }
  }
}