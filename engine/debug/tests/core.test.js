import { createGame } from '../../rules/game.js';
import {
  applyMove, afterMoveEvaluation, getAllLegalMoves,
  executeDrop, isPromotionAvailableForMove
} from '../../rules/core.js';
import { isKingInCheck } from '../../rules/check.js';
import { SIDE } from '../../constants.js';

describe('Core engine', () => {
  // Helper: build a piece object with required properties
  // ES: Helper: build a piece object with required properties
  // Ayudante: construye una pieza con las propiedades necesarias
  // ES: Ayudante: construye una pieza con las propiedades necesarias
  const piece = (type, side, extra = {}) => ({
    type, side, promoted: false, locked: false,
    id: Math.random().toString(36).slice(2),
    ...extra
  });

  // ─── Movement & turn change ──────────────────────────
  test('applyMove changes turn and updates board', () => {
    const game = createGame();
    const moves = getAllLegalMoves(game, SIDE.WHITE);
    expect(moves.length).toBeGreaterThan(0);
    const firstMove = moves[0];
    const initialBoard = JSON.stringify(game.board);
    applyMove(game, firstMove);
    expect(game.turn).toBe(SIDE.BLACK);
    expect(JSON.stringify(game.board)).not.toBe(initialBoard);
  });

  // ─── Checkmate detection ────────────────────────────
  test('afterMoveEvaluation detects checkmate', () => {
    const game = createGame();
    for (let r = 0; r < 13; r++)
      for (let c = 0; c < 13; c++)
        game.board[r][c] = null;

    // Kings
    game.board[12][6] = piece('king', SIDE.WHITE);
    game.board[0][0]   = piece('king', SIDE.BLACK);

    // Black rook delivering check
    // ES: Black rook delivering check
    game.board[11][6] = piece('tower', SIDE.BLACK);

    // Surround the white king to block all escapes
    // ES: Surround the white king to block all escapes
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
    expect(legalMoves).toHaveLength(0);
    expect(isKingInCheck(game, SIDE.WHITE)).toBe(true);

    afterMoveEvaluation(game);
    expect(game.status).toBe('checkmate');
  });

  // ─── Stalemate detection ─────────────────────────────
  test('afterMoveEvaluation detects stalemate', () => {
    const game = createGame();
    for (let r = 0; r < 13; r++)
      for (let c = 0; c < 13; c++)
        game.board[r][c] = null;

    // White king at bottom‑left corner
    // ES: White king at bottom‑left corner
    game.board[12][0] = piece('king', SIDE.WHITE);

    game.board[11][0] = piece('pawn', SIDE.BLACK);
    game.board[11][1] = piece('tower', SIDE.BLACK);
    game.board[12][1] = piece('pawn', SIDE.BLACK);
    game.board[12][2] = piece('pawn', SIDE.BLACK);

    // Black king far away, impossible to give check
    // ES: Black king far away, impossible to give check
    game.board[0][0] = piece('king', SIDE.BLACK);

    game.turn = SIDE.WHITE;

    const legalMoves = getAllLegalMoves(game, SIDE.WHITE);
    expect(legalMoves).toHaveLength(0);
    expect(isKingInCheck(game, SIDE.WHITE)).toBe(false);

    afterMoveEvaluation(game);
    expect(game.status).toBe('stalemate');
  });

  // ─── Reserve drop ────────────────────────────────────
  test('executeDrop places a reserve piece on a legal square', () => {
    const game = createGame();
    game.reserves.white.push({ id: 'test', type: 'tower', side: SIDE.WHITE });
    const drop = executeDrop(game, 0, { r: 11, c: 5 });
    expect(drop).toBe(true);
    expect(game.board[11][5].type).toBe('tower');
    expect(game.board[11][5].side).toBe(SIDE.WHITE);
    expect(game.reserves.white.length).toBe(0);
  });

  // ─── Promotion availability ─────────────────────────
  test('isPromotionAvailableForMove returns true when piece reaches promotion zone', () => {
    const game = createGame();
    game.board[2][6] = { type: 'pawn', side: SIDE.WHITE, promoted: false, locked: false, id: 'p1' };
    const from = { r: 2, c: 6 };
    const to   = { r: 0, c: 6 };   // inside white's promotion zone
    expect(isPromotionAvailableForMove(game, from, to)).toBe(true);
  });
});