import { createGame } from '../engine/rules/game.js';
import { getAllLegalMoves } from '../engine/rules/core.js';
import { SIDE } from '../engine/constants.js';

const piece = (type, side, extra = {}) => ({ type, side, promoted: false, locked: false, id: Math.random().toString(36).slice(2), ...extra });

const game = createGame();
for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) game.board[r][c] = null;
// Kings
game.board[12][6] = piece('king', SIDE.WHITE);
game.board[0][0]   = piece('king', SIDE.BLACK);

// Black rook delivering check
game.board[11][6] = piece('tower', SIDE.BLACK);

// Surround the white king to block all escapes
game.board[11][5] = piece('pawn', SIDE.BLACK);
game.board[11][7] = piece('pawn', SIDE.BLACK);
game.board[12][5] = piece('pawn', SIDE.BLACK);
game.board[12][7] = piece('pawn', SIDE.BLACK);
game.board[12][4] = piece('pawn', SIDE.BLACK);
game.board[12][8] = piece('pawn', SIDE.BLACK);
game.board[10][4] = piece('pawn', SIDE.BLACK);
game.board[10][8] = piece('pawn', SIDE.BLACK);
game.board[10][6] = piece('pawn', SIDE.BLACK);

game.turn = SIDE.WHITE;

const legalMoves = getAllLegalMoves(game, SIDE.WHITE);
console.log('legalMoves length:', legalMoves.length);
console.log(JSON.stringify(legalMoves, null, 2));
const { isSquareAttacked, isKingInCheck } = await import('../engine/rules/check.js');
console.log('isKingInCheck:', isKingInCheck(game, SIDE.WHITE));
for (const m of legalMoves) {
  const r = m.to.r, c = m.to.c;
  console.log('Square', r, c, 'attacked by black?', isSquareAttacked(game.board, r, c, SIDE.BLACK, game));
}
