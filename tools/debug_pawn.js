import { createGame } from '../engine/rules/game.js';
import { isKingInCheck } from '../engine/rules/check.js';
import { findKings } from '../engine/rules/board.js';
import { SIDE } from '../engine/constants.js';

const game = createGame();
console.log('Initial kings:', findKings(game.board));
// Move pawn from 10,6 to 0,6 as test does
game.board[0][6] = game.board[10][6];
game.board[10][6] = null;
game.board[0][6].side = SIDE.WHITE;
console.log('After move kings:', findKings(game.board));
console.log('Square 0,6 contains:', game.board[0][6]);
console.log('isKingInCheck(BLACK):', isKingInCheck(game, SIDE.BLACK));
