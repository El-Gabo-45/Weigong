import { createGame } from '../src/rules/game.js';
import { evaluate, computeFullHash } from '../src/ai/index.js';
import { SIDE } from '../src/constants.js';

describe('Evaluation function', () => {
  test('evalúa la posición inicial y devuelve un objeto con score y métricas', () => {
    const game = createGame();
    const hash = computeFullHash(game);
    const result = evaluate(game, hash);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('metrics');
    expect(typeof result.score).toBe('number');
    // La evaluación inicial debería estar cerca de 0 (equilibrio)
    expect(Math.abs(result.score)).toBeLessThan(200);
  });

  test('el blanco tiene ventaja material si se le da una torre extra', () => {
    const game = createGame();
    game.board[11][4] = { type: 'tower', side: SIDE.WHITE, promoted: false };
    const hash = computeFullHash(game);
    const result = evaluate(game, hash);
    expect(result.score).toBeLessThan(0);
  });
});