import { dbg } from '../debug/debug.js';
import { BOARD_SIZE, SIDE, isPalaceSquare, opponent, inBounds, forwardDir, onBank, isOwnSide, isRiverSquare } from '../constants.js';
import { findKings, pathSquares } from './board.js';

function addForAttack(moves, board, r, c, fk) { if (inBounds(r, c)) moves.push([r, c]); }

export function attackSquaresForPiece(board, piece, r, c, state) {
  const moves = [];
  const f = forwardDir(piece.side);
  const add = (nr, nc) => { if (inBounds(nr, nc)) moves.push([nr, nc]); };
  const promo = piece.promoted;
  const kind = piece.type;
  if (!promo) {
    if (kind === "king") { for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { if (dr===0&&dc===0) continue; for (let step=1;step<=2;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } } return moves; }
    if (kind === "queen") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } return moves; }
    if (kind === "general") { for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) add(r+dr,c+dc); for (let i=1;i<=4;i++) { add(r+i,c+i); add(r+i,c-i); add(r-i,c+i); add(r-i,c-i); } return moves; }
    if (kind === "elephant") { for (const [dr,dc,mx] of [[f,0,2],[f,-1,1],[f,1,1],[-f,-1,2],[-f,1,2]]) { for (let step=1;step<=mx;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; let blocked=false; for (let i=1;i<step;i++) { const tr=r+dr*i,tc=c+dc*i; if (!inBounds(tr,tc)||board[tr][tc]){blocked=true;break;} } if (blocked) break; add(nr,nc); } } return moves; }
    if (kind === "priest") { for (const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } add(r+f,c); add(r-f,c); return moves; }
    if (kind === "horse") { const clr = p => { for (const [pr,pc] of p) if (!inBounds(pr,pc)||board[pr][pc]) return false; return true; }; const hm = [{d:[r+2,c+1],a:[[r+1,c],[r+2,c]],b:[[r,c+1],[r+1,c+1]]},{d:[r+2,c-1],a:[[r+1,c],[r+2,c]],b:[[r,c-1],[r+1,c-1]]},{d:[r-2,c+1],a:[[r-1,c],[r-2,c]],b:[[r,c+1],[r-1,c+1]]},{d:[r-2,c-1],a:[[r-1,c],[r-2,c]],b:[[r,c-1],[r-1,c-1]]},{d:[r+1,c+2],a:[[r,c+1],[r,c+2]],b:[[r+1,c],[r+1,c+1]]},{d:[r+1,c-2],a:[[r,c-1],[r,c-2]],b:[[r+1,c],[r+1,c-1]]},{d:[r-1,c+2],a:[[r,c+1],[r,c+2]],b:[[r-1,c],[r-1,c+1]]},{d:[r-1,c-2],a:[[r,c-1],[r,c-2]],b:[[r-1,c],[r-1,c-1]]}]; for (const m of hm) { const [nr,nc]=m.d; if (!inBounds(nr,nc)) continue; if (!clr(m.a)&&!clr(m.b)) continue; if (!board[nr][nc]||board[nr][nc].side!==piece.side) add(nr,nc); } return moves; }
    if (kind === "cannon") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { let seen=0; for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; if (!board[nr][nc]){if(seen===0)add(nr,nc);continue;} seen++; if(seen===1)continue; if(seen===2&&board[nr][nc].side!==piece.side)add(nr,nc); break; } } return moves; }
    if (kind === "tower") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } return moves; }
    if (kind === "carriage") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]) for (let step=1;step<=(Math.abs(dr)+Math.abs(dc)===1?4:1);step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)||!isOwnSide(piece.side,nr)) break; add(nr,nc); } return moves; }
    if (kind === "archer") { if (onBank(piece.side,r)) { const row=r+f; for (const dc of [-1,0,1]) { const nc=c+dc; if (inBounds(row,nc)) add(row,nc); } } for (const [dr,dc] of [[3,1],[3,-1],[-3,1],[-3,-1],[1,3],[1,-3],[-1,3],[-1,-3]]) { const nr=r+dr,nc=c+dc; if (!inBounds(nr,nc)||!isOwnSide(piece.side,nr)) continue; add(nr,nc); } return moves; }
    if (kind === "pawn") {
      const sk = row => isRiverSquare(row) ? row + f : row;
      const nr = sk(r + f);
      if (inBounds(nr, c) && !board[nr][c]) add(nr, c);
      const nd = sk(r + f);
      if (inBounds(nd, c - 1)) { const t = board[nd][c - 1]; if (t && t.side !== piece.side) add(nd, c - 1); }
      if (inBounds(nd, c + 1)) { const t = board[nd][c + 1]; if (t && t.side !== piece.side) add(nd, c + 1); }
      if (isOwnSide(piece.side, r)) {
        if (inBounds(r, c - 1)) { const t = board[r][c - 1]; if (t && t.side !== piece.side) add(r, c - 1); }
        if (inBounds(r, c + 1)) { const t = board[r][c + 1]; if (t && t.side !== piece.side) add(r, c + 1); }
      }
      if (!isOwnSide(piece.side, r)) {
        if (inBounds(r, c - 1)) { const t = board[r][c - 1]; if (!t || t.side !== piece.side) add(r, c - 1); }
        if (inBounds(r, c + 1)) { const t = board[r][c + 1]; if (!t || t.side !== piece.side) add(r, c + 1); }
        // Keep pawn behavior: no backward-diagonal attacks after crossing.
        // ES: Keep pawn behavior: no backward-diagonal attacks after crossing.
      }
      return moves;
    }
    if (kind === "crossbow") {
      const addWithRiverRule = (dr, dc) => {
        const step1r = r + dr;
        const step1c = c + dc;
        if (!inBounds(step1r, step1c)) return;
        if (isRiverSquare(step1r)) {
          // No piece can ever end on the river: if blocked, do not attack beyond.
          // ES: No piece can ever end on the river: if blocked, do not attack beyond.
          if (board[step1r][step1c]) return;
          // If empty, attack the square beyond (the actual landing square).
          // ES: If empty, attack the square beyond (the actual landing square).
          add(step1r + dr, step1c);
          return;
        }
        add(step1r, step1c);
      };
      for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) addWithRiverRule(dr, dc);
      addWithRiverRule(f, 0);
      return moves;
    }
  }
  if (promo) {
    if (kind === "elephant") for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2*f,0]]) add(r+dr,c+dc);
    else if (kind === "horse") { for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { if (dr===0&&dc===0) continue; add(r+dr,c+dc); } for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) add(r+dr,c+dc); }
    else if (kind === "priest") { for (const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) for (let step=1;step<=4;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) add(r+dr,c+dc); }
    else if (kind === "cannon") { for (const [dr,dc] of [[1,0],[-1,0]]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } for (const [dr,dc] of [[1,1],[-1,-1]]) { let seen=0; for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; if (!board[nr][nc]){if(seen===0)add(nr,nc);continue;} seen++; if (seen===2&&board[nr][nc].side!==piece.side) add(nr,nc); if (seen>=2) break; } } }
    else if (kind === "tower") for (const [dr,dc] of [[0,1],[0,-1],[-1,1],[1,-1]]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; }
    else if (kind === "pawn") {
      // Promoted pawn attacks like crossbow (including river skip)
      // ES: Promoted pawn attacks like crossbow (including river skip)
      const addWithRiverRule = (dr, dc) => {
        const step1r = r + dr;
        const step1c = c + dc;
        if (!inBounds(step1r, step1c)) return;
        if (isRiverSquare(step1r)) {
          if (board[step1r][step1c]) return;
          add(step1r + dr, step1c);
          return;
        }
        add(step1r, step1c);
      };
      for (const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) addWithRiverRule(dr, dc);
      addWithRiverRule(f, 0);
    }
  }
  return moves;
}

export function isSquareAttacked(board, r, c, bySide, state) {
  if (!board || !Array.isArray(board)) return false;

  for (let rr = 0; rr < BOARD_SIZE; rr++) {
    if (!board[rr]) continue;
    for (let cc = 0; cc < BOARD_SIZE; cc++) {
      const p = board[rr][cc];
      if (!p || p.side !== bySide) continue;
      const attacks = attackSquaresForPiece(board, p, rr, cc, state);
      for (const move of attacks) {
        const ar = Array.isArray(move) ? move[0] : move.r;
        const ac = Array.isArray(move) ? move[1] : move.c;
        if (ar === r && ac === c) return true;
      }
    }
  }
  const kings = findKings(board);
  const enemyKing = kings[bySide];
  const myKing = kings[opponent(bySide)];
  if (enemyKing && myKing) {
    const inPalace = isPalaceSquare(enemyKing.r, enemyKing.c, bySide) || isPalaceSquare(myKing.r, myKing.c, opponent(bySide));
    if (inPalace && enemyKing.c === myKing.c) {
      const between = pathSquares(enemyKing.r, enemyKing.c, myKing.r, myKing.c);
      if (!between.some(([rr, cc]) => board[rr][cc])) return true;
    }
  }
  return false;
}

export function isKingInCheck(state, side) {
  const t = dbg.perf.start('isKingInCheck');
  const board = state.board;
  const kings = findKings(board);
  const king = kings[side];
  if (!king) {
    dbg.rules.warn('King not found!', { side });
    dbg.perf.end(t);
    return true;
  }
  const result = isSquareAttacked(board, king.r, king.c, opponent(side), state);
  if (result) dbg.rules(`Check! ${side} king at ${king.r},${king.c} attacked`);
  dbg.perf.end(t);
  return result;
}
