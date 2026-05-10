// ═════════════════════════════════════════════════════
//  Game Constants & Utilities (EN/ES)
// ═════════════════════════════════════════════════════

export const BOARD_SIZE = 13;
export const RIVER_ROW = 6;
export const PALACE_COL_START = 5;
export const PALACE_COL_END = 7;

export const SIDE = {
  WHITE: "white",
  BLACK: "black",
};

// Piece metadata: kanji symbol, promoted variant, and if it goes to reserve on capture
export const PIECE_DATA = {
  king:      { kanji: "王", promoted: null, reusable: false },
  queen:     { kanji: "后", promoted: null, reusable: false },
  general:   { kanji: "師", promoted: null, reusable: true },     //  va a reserva al ser capturada
  elephant:  { kanji: "象", promoted: "毅", reusable: false },
  priest:    { kanji: "仙", promoted: "叡", reusable: false },
  horse:     { kanji: "馬", promoted: "駿", reusable: false },
  cannon:    { kanji: "炮", promoted: "熕", reusable: false },
  tower:     { kanji: "塔", promoted: "𨐌", reusable: true },
  carriage:  { kanji: "輦", promoted: null, reusable: false },
  archer:    { kanji: "矢", promoted: null, reusable: false },
  pawn:      { kanji: "兵", promoted: "弩", reusable: true },     // promoted pawn = crossbow
  crossbow:  { kanji: "弩", promoted: null, reusable: true },
};

export const PROMOTABLE = new Set(["elephant", "priest", "horse", "cannon", "tower", "pawn"]);
export const RESERVED_DROP_TYPES = new Set(["tower", "general", "pawn", "crossbow"]);
export const NO_PROMOTE_TYPES = new Set(["king", "queen", "general", "carriage", "archer"]);

export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
export function opponent(side) { return side === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE; }
export function inBounds(r, c) { return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE; }
export function isRiverSquare(r) { return r === RIVER_ROW; }

// Palace zones: black at top (rows 0-2), white at bottom (rows 10-12)
export function isPalaceSquare(r, c, side) {
  if (c < PALACE_COL_START || c > PALACE_COL_END) return false;
  if (side === SIDE.BLACK) return r >= 0 && r <= 2;
  return r >= 10 && r <= 12;
}

// Own side: black above river (r<6), white below (r>6)
export function isOwnSide(side, r) {
  return side === SIDE.BLACK ? r < RIVER_ROW : r > RIVER_ROW;
}

// Forward direction: black advances downward (+1), white upward (-1)
export function forwardDir(side) {
  return side === SIDE.BLACK ? 1 : -1;
}

// Promotion zone: last 3 rows of enemy territory
export function homePromotionZone(side, r) {
  return side === SIDE.BLACK ? r >= 10 : r <= 2;
}

// Bank row: the row just before the river (archer placement zone)
export function bankRow(side) {
  return side === SIDE.BLACK ? RIVER_ROW - 1 : RIVER_ROW + 1;
}
export function onBank(side, r) { return r === bankRow(side); }

export function pieceLabel(piece) {
  const base = PIECE_DATA[piece.type]?.kanji ?? "?";
  const promo = piece.promoted ? (PIECE_DATA[piece.type]?.promoted ?? base) : base;
  return piece.promoted ? promo : base;
}
export function pieceDisplayType(piece) {
  if (!piece.promoted) return piece.type;
  if (piece.type === "pawn") return "crossbow";
  return piece.type;
}
export function canDropOnSide(type, side, r) {
  if (type === "crossbow") return true;
  return isOwnSide(side, r);
}
export function isPromotableType(type) { return PROMOTABLE.has(type); }
export function isReserveType(type) { return RESERVED_DROP_TYPES.has(type); }
export function getPromotedSymbol(type) {
  const map = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  return map[type] || type[0].toUpperCase();
}