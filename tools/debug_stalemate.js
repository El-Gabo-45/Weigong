import { createGame } from '../engine/rules/game.js';
import { isSquareAttacked, attackSquaresForPiece } from '../engine/rules/check.js';
import { SIDE } from '../engine/constants.js';

function piece(type, side) { return { type, side, promoted:false, locked:false, id: Math.random().toString(36).slice(2) }; }
const game = createGame();
for (let r=0;r<13;r++) for (let c=0;c<13;c++) game.board[r][c] = null;
// White king at bottom‑left corner
game.board[12][0] = piece('king', SIDE.WHITE);

game.board[11][0] = piece('pawn', SIDE.BLACK);
game.board[11][1] = piece('tower', SIDE.BLACK);
game.board[12][1] = piece('pawn', SIDE.BLACK);
game.board[12][2] = piece('pawn', SIDE.BLACK);
// Black king far away
game.board[0][0] = piece('king', SIDE.BLACK);

game.turn = SIDE.WHITE;

console.log('isKingInCheck(WHITE):', (await import('../engine/rules/check.js')).isKingInCheck(game, SIDE.WHITE));

// Inspect which black piece attacks (12,0)
for (let r=0;r<13;r++){
  for (let c=0;c<13;c++){
    const p = game.board[r][c];
    if (!p || p.side !== SIDE.BLACK) continue;
    const attacks = attackSquaresForPiece(game.board, p, r, c, game);
    for (const a of attacks) {
      const ar = Array.isArray(a)?a[0]:a.r;
      const ac = Array.isArray(a)?a[1]:a.c;
      if (ar===12 && ac===0) {
        console.log('Attacker:', r,c,p.type, 'attacks 12,0 via', a);
      }
    }
  }
}

console.log('Done');
