// ═════════════════════════════════════════════════════
//  River Jump Utilities (EN/ES)
// ES: Utilidades de salto de río
//  Centralizes the river-skip logic used by multiple piece types
//  (crossbow, promoted elephant, promoted pawn) across moves.js, check.js
// ES: Centraliza la lógica de salto de río usada por múltiples piezas
// ═════════════════════════════════════════════════════

import { inBounds, isRiverSquare } from '../constants.js';
import type { Board } from '../types.js';

export interface RiverJumpResult {
  r: number;
  c: number;
}

/**
 * Applies a move that may skip over the river.
 * If the first step lands on the river, the piece jumps over it
 * (the river square must be empty). Otherwise, it moves one step normally.
 * Returns the destination {r, c} if reachable, or null if blocked.
 * ES: Aplica un movimiento que puede saltar sobre el río.
 */
export function applyRiverJump(board: Board, r: number, c: number, dr: number, dc: number): RiverJumpResult | null {
  const step1r = r + dr;
  const step1c = c + dc;
  if (!inBounds(step1r, step1c)) return null;

  // If the first step lands on the river, skip over it
  if (isRiverSquare(step1r)) {
    // The river square must be empty to jump over it
    if (board[step1r][step1c]) return null;
    const step2r = step1r + dr;
    const step2c = step1c;
    if (!inBounds(step2r, step2c)) return null;
    return { r: step2r, c: step2c };
  }

  return { r: step1r, c: step1c };
}

/**
 * Same as applyRiverJump but returns true/false whether a given target square
 * is reachable via river jump. Used by check.js attack tests.
 * ES: Igual que applyRiverJump pero retorna true/false si una casilla objetivo
 * es alcanzable mediante salto de río.
 */
export function testRiverJump(board: Board, r: number, c: number, dr: number, dc: number, tr: number, tc: number): boolean {
  const dest = applyRiverJump(board, r, c, dr, dc);
  return dest !== null && dest.r === tr && dest.c === tc;
}