import { createGame } from '../../rules/game.js';
import { pseudoMovesForPiece } from '../../rules/moves.js';
import { SIDE } from '../../constants.js';

describe('Pseudo moves generation', () => {
  const game = createGame();

  test('black pawns have a forward move at the start', () => {
    const pawnMoves = pseudoMovesForPiece(game.board, game.board[2][6], 2, 6, game);
    const forward = pawnMoves.find(m => m.r === 3 && m.c === 6 && !m.capture);
    expect(forward).toBeDefined();
  });

  test('kings have moves available at the start', () => {
    const king = game.board[0][7];
    const moves = pseudoMovesForPiece(game.board, king, 0, 7, game);
    expect(moves.length).toBeGreaterThan(0);
  });

  test('promoted towers have extra diagonal moves', () => {
    const board = Array.from({ length: 13 }, () => Array(13).fill(null));
    board[6][6] = { type: 'tower', side: SIDE.BLACK, promoted: true };
    const moves = pseudoMovesForPiece(board, board[6][6], 6, 6, { board });
    const hasDiagonal = moves.some(m => m.r !== 6 && m.c !== 6 && (m.r - 6 !== 0 || m.c - 6 !== 0));
    expect(hasDiagonal).toBe(true);
  });
});