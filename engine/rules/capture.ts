// ═════════════════════════════════════════════════════
//  Capture & Reserve Utilities (EN/ES)
// ES: Utilidades de captura y reserva
//  Centralizes capture-to-reserve logic used by core.js and archer.js
// ES: Centraliza la lógica de captura a reserva usada por core.js y archer.js
// ═════════════════════════════════════════════════════

import { isReserveType } from '../constants.js';
import type { GameState, Piece, Side } from '../types.js';

let _idCounter = 0;

/**
 * Adds a captured piece to the appropriate reserve.
 * Only pieces that go to reserve (tower, general, pawn, crossbow) are added.
 * ES: Agrega una pieza capturada a la reserva correspondiente.
 * Solo las piezas que van a reserva (torre, general, peón, ballesta) se agregan.
 */
export function captureToReserve(state: GameState, captured: Piece | null, captorSide: Side): void {
  if (!captured) return;
  const type = captured.promoted
    ? (captured.type === "pawn" ? "crossbow" : captured.type)
    : captured.type;
  if (!isReserveType(type)) return;
  const id = `cap_${Date.now()}_${++_idCounter}`;
  state.reserves[captorSide].push({ id, type: type as any, side: captorSide, promoted: false });
}