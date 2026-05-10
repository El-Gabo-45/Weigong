import { createGame } from '../src/rules/game.js';
import { isKingInCheck, isSquareAttacked } from '../src/rules/check.js';
import { SIDE } from '../src/constants.js';

describe('Check detection', () => {
  test('en la posición inicial ningún rey está en jaque', () => {
    const game = createGame();
    expect(isKingInCheck(game, SIDE.WHITE)).toBe(false);
    expect(isKingInCheck(game, SIDE.BLACK)).toBe(false);
  });

  test('un peón blanco que alcanza la fila del rey negro da jaque', () => {
    const game = createGame();
    game.board[0][6] = game.board[10][6];
    game.board[10][6] = null;
    game.board[0][6].side = SIDE.WHITE;
    expect(isKingInCheck(game, SIDE.BLACK)).toBe(true);
  });

  test('una torre blanca en la misma columna que el rey negro, sin obstáculos, es ataque', () => {
    const game = createGame();
    for (let r = 0; r < 13; r++) game.board[r][7] = null;
    game.board[5][7] = { type: 'tower', side: SIDE.WHITE, promoted: false };
    game.board[0][7] = { type: 'king', side: SIDE.BLACK, promoted: false };
    expect(isSquareAttacked(game.board, 0, 7, SIDE.WHITE, game)).toBe(true);
  });
});