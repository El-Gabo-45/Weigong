import { createGame } from '../src/rules/game.js';
import { makePiece, findKings, boardSignature } from '../src/rules/board.js';
import { SIDE } from '../src/constants.js';

describe('Board utilities', () => {
  test('createGame genera estado inicial válido', () => {
    const game = createGame();
    expect(game.board.length).toBe(13);
    expect(game.board[0].length).toBe(13);
    expect(game.board[0][0].type).toBe('tower');
    expect(game.board[0][0].side).toBe(SIDE.BLACK);
    expect(game.board[12][0].type).toBe('tower');
    expect(game.board[12][0].side).toBe(SIDE.WHITE);
    expect(game.board[2][0].type).toBe('pawn');
    expect(game.board[2][0].side).toBe(SIDE.BLACK);
    expect(game.board[10][0].type).toBe('pawn');
    expect(game.board[10][0].side).toBe(SIDE.WHITE);
  });

  test('findKings localiza ambos reyes en la posición inicial', () => {
    const game = createGame();
    const kings = findKings(game.board);
    expect(kings.white).toBeDefined();
    expect(kings.black).toBeDefined();
    expect(kings.white.r).toBe(12);
    expect(kings.white.c).toBe(6);
    expect(kings.black.r).toBe(0);
    expect(kings.black.c).toBe(6);
  });

  test('boardSignature produce un string único para la posición inicial', () => {
    const game = createGame();
    const sig = boardSignature(game);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(100);
  });
});