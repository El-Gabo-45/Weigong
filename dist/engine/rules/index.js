// ═════════════════════════════════════════════════════
//  Rules Engine Barrel (EN/ES)
// ES: Barril del motor de reglas
//  Central export point for all rules modules.
// ES: Punto de exportación central para todos los módulos de reglas.
// ═════════════════════════════════════════════════════
export { createGame, resetGame } from './game.js';
export { makePiece, findKings, boardSignature, cloneState, initialLayout } from './board.js';
export { getLegalMovesForSquare, pseudoMovesForPiece, rayMoves, jumpMoves, addIfValid } from './moves.js';
export { isKingInCheck, isSquareAttacked, attackSquaresForPiece } from './check.js';
export { isSquareProtectedByArcher, getArcherAmbushResult, executeArcherAmbush, getArcherBlockedSquares } from './archer.js';
export { updatePalaceState, isPalaceCursedFor, getPalaceInvaders } from './state.js';
export { getPieceMoves, getAllLegalMoves, getReserveEntries, applyMove, executeDrop, isPromotionAvailableForMove, afterMoveEvaluation, getBoardMeta, getPieceText, getLegalReserveDrops, moveWouldPromote, isDropLegal, } from './core.js';
