import { createGame } from '../../rules/game.js';
import { isKingInCheck, isSquareAttacked } from '../../rules/check.js';
import { SIDE } from '../../constants.js';

describe('Check detection', () => {
  test('in the starting position neither king is in check', () => {
    const game = createGame();
    expect(isKingInCheck(game, SIDE.WHITE)).toBe(false);
    expect(isKingInCheck(game, SIDE.BLACK)).toBe(false);
  });

  test("a white pawn reaching the black king's row gives check", () => {
    const game = createGame();
    game.board[0][6] = game.board[10][6];
    game.board[10][6] = null;
    game.board[0][6].side = SIDE.WHITE;
    expect(isKingInCheck(game, SIDE.BLACK)).toBe(true);
  });

  test('a white rook on the same file as the black king with no obstructions is an attack', () => {
    const game = createGame();
    for (let r = 0; r < 13; r++) game.board[r][7] = null;
    game.board[5][7] = { type: 'tower', side: SIDE.WHITE, promoted: false };
    game.board[0][7] = { type: 'king', side: SIDE.BLACK, promoted: false };
    expect(isSquareAttacked(game.board, 0, 7, SIDE.WHITE, game)).toBe(true);
  });
});