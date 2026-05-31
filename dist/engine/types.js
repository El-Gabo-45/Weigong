// ═════════════════════════════════════════════════════
//  Core Type Definitions for Weigong Engine
// ES: Definiciones de tipos núcleo para el motor Weigong
// ═════════════════════════════════════════════════════
// Piece ID encoding for typed array board
export const PIECE_KING = 0;
export const PIECE_QUEEN = 1;
export const PIECE_GENERAL = 2;
export const PIECE_ELEPHANT = 3;
export const PIECE_PRIEST = 4;
export const PIECE_HORSE = 5;
export const PIECE_CANNON = 6;
export const PIECE_TOWER = 7;
export const PIECE_CARRIAGE = 8;
export const PIECE_ARCHER = 9;
export const PIECE_PAWN = 10;
export const PIECE_CROSSBOW = 11;
export const PIECE_ENCODING = {
    king: PIECE_KING, queen: PIECE_QUEEN, general: PIECE_GENERAL,
    elephant: PIECE_ELEPHANT, priest: PIECE_PRIEST, horse: PIECE_HORSE,
    cannon: PIECE_CANNON, tower: PIECE_TOWER, carriage: PIECE_CARRIAGE,
    archer: PIECE_ARCHER, pawn: PIECE_PAWN, crossbow: PIECE_CROSSBOW,
};
export const PIECE_DECODING = {
    [PIECE_KING]: 'king', [PIECE_QUEEN]: 'queen', [PIECE_GENERAL]: 'general',
    [PIECE_ELEPHANT]: 'elephant', [PIECE_PRIEST]: 'priest', [PIECE_HORSE]: 'horse',
    [PIECE_CANNON]: 'cannon', [PIECE_TOWER]: 'tower', [PIECE_CARRIAGE]: 'carriage',
    [PIECE_ARCHER]: 'archer', [PIECE_PAWN]: 'pawn', [PIECE_CROSSBOW]: 'crossbow',
};
// Encode a piece into a single Uint16 value for typed array storage
// Bits: [side:1][type:4][promoted:1][padding:10]
export function encodePiece(piece) {
    if (!piece)
        return 0;
    const sideBit = piece.side === 'black' ? 0x8000 : 0x4000;
    const typeBits = (PIECE_ENCODING[piece.type] & 0xF) << 8;
    const promoBit = piece.promoted ? 0x0100 : 0;
    return sideBit | typeBits | promoBit;
}
export function decodePiece(encoded) {
    if (encoded === 0)
        return null;
    const side = (encoded & 0x8000) ? 'black' : 'white';
    const typeEnc = (encoded >> 8) & 0xF;
    const type = PIECE_DECODING[typeEnc];
    if (!type)
        return null;
    const promoted = !!(encoded & 0x0100);
    return { type, side, promoted };
}
