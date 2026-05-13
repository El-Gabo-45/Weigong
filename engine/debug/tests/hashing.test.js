import { createGame } from '../../rules/game.js';
import { computeFullHash, TranspositionTable } from '../../ai/hashing.js';

describe('Zobrist Hashing', () => {
  test('the same position produces the same hash', () => {
    const game1 = createGame();
    const game2 = createGame();
    expect(computeFullHash(game1)).toBe(computeFullHash(game2));
  });

  test('different positions produce different hashes', () => {
    const game1 = createGame();
    const game2 = createGame();
    game2.board[10][4] = game2.board[10][5];
    game2.board[10][5] = null;
    expect(computeFullHash(game1)).not.toBe(computeFullHash(game2));
  });

  test('TranspositionTable stores and retrieves entries correctly', () => {
    const tt = new TranspositionTable(100);
    const hash = 12345n;
    tt.set(hash, { score: 100, depth: 3 });
    const entry = tt.get(hash);
    expect(entry).toBeDefined();
    expect(entry.score).toBe(100);
  });
});