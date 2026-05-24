// ═════════════════════════════════════════════════════
//  Piece Values & Square Bonuses (EN/ES)
// ES: Valores de piezas y bonificaciones por casilla
//  Shared module: imported by evaluation.js, moves.js, search.js
// ES: Módulo compartido: importado por evaluation.js, moves.js, search.js
// ═════════════════════════════════════════════════════

import { SIDE, isPalaceSquare, onBank } from '../constants.js';

export const PIECE_VALUES = {
  king: 0, queen: 950, general: 560, elephant: 240, priest: 400,
  horse: 320, cannon: 450, tower: 520, carriage: 390, archer: 450,
  pawn: 110, crossbow: 240,
};

export const PROMOTED_VALUES = {
  pawn: 240, tower: 520, horse: 430, elephant: 320, priest: 540, cannon: 450,
};

export function pieceValue(piece) {
  const base = PIECE_VALUES[piece.type] ?? 0;
  return piece.promoted ? (PROMOTED_VALUES[piece.type] ?? base + 120) : base;
}

export function seeValue(piece) {
  if (!piece) return 0;
  if (piece.promoted) return PROMOTED_VALUES[piece.type] ?? (PIECE_VALUES[piece.type] ?? 0) + 120;
  return PIECE_VALUES[piece.type] ?? 0;
}

export function centerBonus(r, c) {
  return (12 - Math.abs(r - 6) - Math.abs(c - 6)) * 3;
}

export function pieceSquareBonus(piece, r, c) {
  // prog = advancement from own back rank toward enemy (0=home, 12=enemy back rank)
  // WHITE starts at r=12 and advances toward r=0 → prog = 12 - r
  // BLACK starts at r=0 and advances toward r=12 → prog = r
  // ES: prog = avance desde la fila propia hacia el enemigo (0=casa, 12=fila enemiga)
  const prog = piece.side === SIDE.WHITE ? (12 - r) : r;
  let bonus = centerBonus(r, c);
  switch (piece.type) {
    case 'pawn': bonus += prog * 12; if (piece.promoted) bonus += 22;
      if (piece.side === SIDE.WHITE && r >= 7) bonus += 14;
      if (piece.side === SIDE.BLACK && r <= 5) bonus += 14;
      break;
    case 'horse': bonus += (6 - Math.abs(r - 6)) * 4; break;
    case 'cannon': bonus += prog * 4; break;
    case 'tower': bonus += prog * 4; break;
    case 'priest': bonus += 16; break;
    case 'archer': bonus += 16; if (onBank(piece.side, r)) bonus += 300; bonus += prog * 10; break;
    case 'king': bonus += isPalaceSquare(r, c, piece.side) ? 90 : -70; break;
    case 'queen': bonus += 35; break;
    case 'general': bonus += 18; break;
    case 'carriage': bonus += 10; break;
    case 'elephant': bonus += 8; break;
    case 'crossbow': bonus += 20; break;
  }
  return bonus;
}