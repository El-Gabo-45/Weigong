import { createGame } from '../../rules/game.js';
import { evaluate, computeFullHash } from '../../ai/index.js';
import { SIDE } from '../../constants.js';

describe('Evaluation function', () => {
  test('evaluates the initial position and returns an object with score and metrics', () => {
    const game = createGame();
    const hash = computeFullHash(game);
    const result = evaluate(game, hash);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('metrics');
    expect(typeof result.score).toBe('number');
    expect(Math.abs(result.score)).toBeLessThan(200);
  });

  test('white has a material advantage if given an extra tower', () => {
    const game = createGame();
    game.board[11][4] = { type: 'tower', side: SIDE.WHITE, promoted: false };
    const hash = computeFullHash(game);
    const result = evaluate(game, hash);
    expect(result.score).toBeLessThan(0);
  });
});