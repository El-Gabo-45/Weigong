// ═════════════════════════════════════════════════════
//  Game Constants & Utilities (EN/ES)
// ES: Game Constants & Utilities (EN/ES)
// ═════════════════════════════════════════════════════

import type { Side, Piece, PieceType } from './types.js';

export const BOARD_SIZE = 13;
export const RIVER_ROW = 6;
export const PALACE_COL_START = 5;
export const PALACE_COL_END = 7;

export const SIDE = {
  WHITE: "white" as Side,
  BLACK: "black" as Side,
};

export const SIDE_VALUES: Side[] = ['white', 'black'];

// Piece metadata: kanji symbol, promoted variant, and if it goes to reserve on capture
// ES: Piece metadata: kanji symbol, promoted variant, and if it goes to reserve on capture
interface PieceDataEntry {
  kanji: string;
  promoted: string | null;
  reusable: boolean;
}

export const PIECE_DATA: Record<string, PieceDataEntry> = {
  king:      { kanji: "王", promoted: null, reusable: false },
  queen:     { kanji: "后", promoted: null, reusable: false },
  general:   { kanji: "師", promoted: null, reusable: true },
  elephant:  { kanji: "象", promoted: "毅", reusable: false },
  priest:    { kanji: "仙", promoted: "叡", reusable: false },
  horse:     { kanji: "馬", promoted: "駿", reusable: false },
  cannon:    { kanji: "炮", promoted: "熕", reusable: false },
  tower:     { kanji: "塔", promoted: "𨐌", reusable: true },
  carriage:  { kanji: "輦", promoted: null, reusable: false },
  archer:    { kanji: "矢", promoted: null, reusable: false },
  pawn:      { kanji: "兵", promoted: "弩", reusable: true },
  crossbow:  { kanji: "弩", promoted: null, reusable: true },
};

export const PROMOTABLE = new Set(["elephant", "priest", "horse", "cannon", "tower", "pawn"]);
export const RESERVED_DROP_TYPES = new Set(["tower", "general", "pawn", "crossbow"]);
export const NO_PROMOTE_TYPES = new Set(["king", "queen", "general", "carriage", "archer"]);

export function clone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }

export function opponent(side: Side): Side { return side === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE; }

export function inBounds(r: number, c: number): boolean { return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE; }

export function isRiverSquare(r: number): boolean { return r === RIVER_ROW; }

// Palace zones: black at top (rows 0-2), white at bottom (rows 10-12)
// ES: Palace zones: black at top (rows 0-2), white at bottom (rows 10-12)
export function isPalaceSquare(r: number, c: number, side: Side): boolean {
  if (c < PALACE_COL_START || c > PALACE_COL_END) return false;
  if (side === SIDE.BLACK) return r >= 0 && r <= 2;
  return r >= 10 && r <= 12;
}

// Own side: black above river (r<6), white below (r>6)
// ES: Own side: black above river (r<6), white below (r>6)
export function isOwnSide(side: Side, r: number): boolean {
  return side === SIDE.BLACK ? r < RIVER_ROW : r > RIVER_ROW;
}

// Forward direction: black advances downward (+1), white upward (-1)
// ES: Forward direction: black advances downward (+1), white upward (-1)
export function forwardDir(side: Side): number {
  return side === SIDE.BLACK ? 1 : -1;
}

// Promotion zone: last 3 rows of enemy territory
// ES: Promotion zone: last 3 rows of enemy territory
export function homePromotionZone(side: Side, r: number): boolean {
  return side === SIDE.BLACK ? r >= 10 : r <= 2;
}

// Bank row: the row just before the river (archer placement zone)
// ES: Bank row: the row just before the river (archer placement zone)
export function bankRow(side: Side): number {
  return side === SIDE.BLACK ? RIVER_ROW - 1 : RIVER_ROW + 1;
}

export function onBank(side: Side, r: number): boolean { return r === bankRow(side); }

export function pieceLabel(piece: Piece): string {
  const base = PIECE_DATA[piece.type]?.kanji ?? "?";
  const promo = piece.promoted ? (PIECE_DATA[piece.type]?.promoted ?? base) : base;
  return piece.promoted ? promo : base;
}

export function pieceDisplayType(piece: Piece): string {
  if (!piece.promoted) return piece.type;
  if (piece.type === "pawn") return "crossbow";
  return piece.type;
}

export function canDropOnSide(type: string, side: Side, r: number): boolean {
  if (type === "crossbow") return true;
  return isOwnSide(side, r);
}

export function isPromotableType(type: string): boolean { return PROMOTABLE.has(type); }

export function isReserveType(type: string): boolean { return RESERVED_DROP_TYPES.has(type); }

export function getPromotedSymbol(type: string): string {
  const map: Record<string, string> = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  return map[type] || type[0].toUpperCase();
}