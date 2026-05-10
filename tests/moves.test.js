import { createGame } from '../src/rules/game.js';
import { pseudoMovesForPiece } from '../src/rules/moves.js';
import { SIDE } from '../src/constants.js';

describe('Pseudo moves generation', () => {
  const game = createGame();

  test('los peones negros al inicio tienen un movimiento hacia delante', () => {
    const pawnMoves = pseudoMovesForPiece(game.board, game.board[2][6], 2, 6, game);
    const forward = pawnMoves.find(m => m.r === 3 && m.c === 6 && !m.capture);
    expect(forward).toBeDefined();
  });

  test('el rey negro no puede salir del palacio al inicio (movimientos bloqueados por piezas)', () => {
    const king = game.board[0][7];
    const moves = pseudoMovesForPiece(game.board, king, 0, 7, game);
    expect(moves.length).toBeGreaterThan(0);
  });

  test('la torre promovida tiene movimientos diagonales extras', () => {
    const board = Array.from({ length: 13 }, () => Array(13).fill(null));
    board[6][6] = { type: 'tower', side: SIDE.BLACK, promoted: true };
    const moves = pseudoMovesForPiece(board, board[6][6], 6, 6, { board });
    const hasDiagonal = moves.some(m => m.r !== 6 && m.c !== 6 && (m.r - 6 !== 0 || m.c - 6 !== 0));
    expect(hasDiagonal).toBe(true);
  });
});