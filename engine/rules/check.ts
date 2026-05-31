// ═════════════════════════════════════════════════════
//  Check & Attack Detection (EN/ES)
// ES: Check & Attack Detection (EN/ES)
// ═════════════════════════════════════════════════════

import { dbg } from '../debug/debug.js';
import { BOARD_SIZE, SIDE, isPalaceSquare, opponent, inBounds, forwardDir, onBank, isOwnSide, isRiverSquare } from '../constants.js';
import { findKings, pathSquares } from './board.js';
import type { Board, Piece, GameState, Side } from '../types.js';

function addForAttack(moves: [number, number][], board: Board, r: number, c: number, fk?: any): void { if (inBounds(r, c)) moves.push([r, c]); }

function _lineClear(board: Board, r: number, c: number, dr: number, dc: number, steps: number): boolean {
  for (let i = 1; i < steps; i++) {
    if (board[r + dr * i][c + dc * i]) return false;
  }
  return true;
}

function _pieceAttacksSquare(board: Board, piece: Piece, r: number, c: number, tr: number, tc: number, state?: GameState): boolean {
  if (r === tr && c === tc) return false;
  const target = board[tr][tc];
  if (target && target.side === piece.side) return false;
  const f = forwardDir(piece.side);
  const dr = tr - r;
  const dc = tc - c;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);
  const sdr = Math.sign(dr);
  const sdc = Math.sign(dc);
  const dist = Math.max(absDr, absDc);
  const forwardRow = r + f;

  const testRay = (maxStep: number): boolean => {
    if (!(dr === 0 || dc === 0 || absDr === absDc)) return false;
    if (dist < 1 || dist > maxStep) return false;
    return _lineClear(board, r, c, sdr, sdc, dist);
  };

  const testRiverJump = (jr: number, jc: number): boolean => {
    const step1r = r + jr;
    const step1c = c + jc;
    if (!inBounds(step1r, step1c)) return false;
    if (isRiverSquare(step1r)) {
      if (board[step1r][step1c]) return false;
      const step2r = step1r + jr;
      const step2c = step1c;
      if (!inBounds(step2r, step2c)) return false;
      return tr === step2r && tc === step2c;
    }
    return tr === step1r && tc === step1c;
  };

  if (!piece.promoted) {
    switch (piece.type) {
      case 'king':
        if (dist > 2 || !(dr === 0 || dc === 0 || absDr === absDc)) return false;
        return _lineClear(board, r, c, sdr, sdc, dist);
      case 'queen':
        return testRay(BOARD_SIZE - 1);
      case 'general':
        if ((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2)) return true;
        if (absDr === absDc && absDr <= 4) return _lineClear(board, r, c, sdr, sdc, absDr);
        return false;
      case 'elephant': {
        for (const [dr0, dc0, maxStep] of [[f, 0, 2], [f, -1, 1], [f, 1, 1], [-f, -1, 2], [-f, 1, 2]]) {
          for (let step = 1; step <= maxStep; step++) {
            if (dr === (dr0 as number) * step && dc === (dc0 as number) * step) {
              if (!_lineClear(board, r, c, Math.sign(dr0 as number), Math.sign(dc0 as number), step)) return false;
              return true;
            }
          }
        }
        return false;
      }
      case 'priest':
        if (dr === 0 && absDc === 1) return true;
        if (dc === 0 && absDr === 1) return true;
        if (absDr === absDc) return _lineClear(board, r, c, sdr, sdc, absDr);
        return false;
      case 'horse': {
        const patterns = [
          { nr: r + 2, nc: c + 1, block: [[r + 1, c], [r + 2, c]] as [number, number][] },
          { nr: r + 2, nc: c - 1, block: [[r + 1, c], [r + 2, c]] as [number, number][] },
          { nr: r - 2, nc: c + 1, block: [[r - 1, c], [r - 2, c]] as [number, number][] },
          { nr: r - 2, nc: c - 1, block: [[r - 1, c], [r - 2, c]] as [number, number][] },
          { nr: r + 1, nc: c + 2, block: [[r, c + 1], [r + 1, c + 1]] as [number, number][] },
          { nr: r + 1, nc: c - 2, block: [[r, c - 1], [r + 1, c - 1]] as [number, number][] },
          { nr: r - 1, nc: c + 2, block: [[r, c + 1], [r - 1, c + 1]] as [number, number][] },
          { nr: r - 1, nc: c - 2, block: [[r, c - 1], [r - 1, c - 1]] as [number, number][] },
        ];
        for (const pattern of patterns) {
          if (pattern.nr === tr && pattern.nc === tc) {
            if (pattern.block.every(([br, bc]) => inBounds(br, bc) && !board[br][bc])) return true;
          }
        }
        return false;
      }
      case 'cannon':
        if (dr !== 0 && dc !== 0) return false;
        if (dist < 1) return false;
        let seen = 0;
        for (let i = 1; i < dist; i++) {
          if (board[r + sdr * i][c + sdc * i]) seen++;
        }
        return seen === 1;
      case 'tower':
        if (dr !== 0 && dc !== 0) return false;
        return _lineClear(board, r, c, sdr, sdc, dist);
      case 'carriage':
        if (absDr === absDc && absDr === 1) return true;
        if (dr !== 0 && dc !== 0) return false;
        if (dist < 1 || dist > 4) return false;
        if (!isOwnSide(piece.side, tr)) return false;
        return _lineClear(board, r, c, sdr, sdc, dist);
      case 'archer':
        if (onBank(piece.side, r) && tr === r + f && absDc <= 1) return true;
        if (!isOwnSide(piece.side, tr)) return false;
        return (absDr === 3 && absDc === 1) || (absDr === 1 && absDc === 3);
      case 'pawn': {
        const forwardTarget = isRiverSquare(forwardRow) && board[forwardRow][c]
          ? null
          : isRiverSquare(forwardRow) ? forwardRow + f : forwardRow;
        if (forwardTarget !== null && inBounds(forwardTarget, c) && !board[forwardTarget][c] && tr === forwardTarget && tc === c) return true;
        if (isOwnSide(piece.side, r)) {
          if (tr === r && absDc === 1 && target && target.side !== piece.side) return true;
          return false;
        }
        if (tr === r && absDc === 1) return true;
        for (const [dr2, dc2] of [[f, 1], [f, -1]]) {
          if (tr === r + dr2 && tc === c + dc2) return true;
        }
        return false;
      }
      case 'crossbow':
        return testRiverJump(f, 0) || (absDr === 1 && absDc === 1 && testRiverJump(dr, dc));
      default:
        return false;
    }
  }

  if (piece.type === 'elephant') {
    const testRiver = (dr0: number, dc0: number): boolean => {
      const step1r = r + dr0;
      const step1c = c + dc0;
      if (!inBounds(step1r, step1c)) return false;
      if (isRiverSquare(step1r)) {
        if (board[step1r][step1c]) return false;
        const step2r = step1r + dr0;
        const step2c = step1c;
        if (!inBounds(step2r, step2c)) return false;
        return tr === step2r && tc === step2c;
      }
      return tr === step1r && tc === step1c;
    };
    if (testRiver(1, 0) || testRiver(-1, 0) || testRiver(0, 1) || testRiver(0, -1) || testRiver(f, 1) || testRiver(f, -1) || testRiver(2, 0)) return true;
    return false;
  }

  if (piece.type === 'horse') {
    for (let dr2 = -1; dr2 <= 1; dr2++) {
      for (let dc2 = -1; dc2 <= 1; dc2++) {
        if (dr2 === 0 && dc2 === 0) continue;
        if (tr === r + dr2 && tc === c + dc2) return true;
      }
    }
    for (const [dr2, dc2] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) {
      if (tr === r + dr2 && tc === c + dc2) return true;
    }
    return false;
  }

  if (piece.type === 'priest') {
    if (absDr === absDc && _lineClear(board, r, c, sdr, sdc, absDr)) return true;
    return (dr === 1 && dc === 0) || (dr === -1 && dc === 0);
  }

  if (piece.type === 'cannon') {
    if (dr !== 0 && dc !== 0) return false;
    if (dist < 1) return false;
    let seen = 0;
    for (let i = 1; i < dist; i++) {
      if (board[r + sdr * i][c + sdc * i]) seen++;
    }
    return seen === 1;
  }

  if (piece.type === 'tower') {
    if (dr !== 0 && dc !== 0) return false;
    return _lineClear(board, r, c, sdr, sdc, dist);
  }

  if (piece.type === 'carriage') {
    if (absDr === absDc && absDr === 1) return true;
    if (dr !== 0 && dc !== 0) return false;
    if (dist < 1 || dist > 4) return false;
    if (!isOwnSide(piece.side, tr)) return false;
    return _lineClear(board, r, c, sdr, sdc, dist);
  }

  if (piece.type === 'archer') {
    if (onBank(piece.side, r) && tr === r + f && absDc <= 1) return true;
    if (!isOwnSide(piece.side, tr)) return false;
    return (absDr === 3 && absDc === 1) || (absDr === 1 && absDc === 3);
  }

  if (piece.type === 'pawn') {
    const forwardTarget = isRiverSquare(forwardRow) ? forwardRow + f : forwardRow;
    if (tr === forwardTarget && tc === c) return true;
    if (isOwnSide(piece.side, r)) {
      if (tr === r && absDc === 1 && target && target.side !== piece.side) return true;
      return false;
    }
    if (tr === r && absDc === 1) return true;
    return (tr === r + f && absDc === 1);
  }

  if (piece.type === 'crossbow') {
    const testRiver = (dr0: number, dc0: number): boolean => {
      const step1r = r + dr0;
      const step1c = c + dc0;
      if (!inBounds(step1r, step1c)) return false;
      if (isRiverSquare(step1r)) {
        if (board[step1r][step1c]) return false;
        const step2r = step1r + dr0;
        const step2c = step1c;
        if (!inBounds(step2r, step2c)) return false;
        return tr === step2r && tc === step2c;
      }
      return tr === step1r && tc === step1c;
    };
    return testRiver(f, 0) || (absDr === 1 && absDc === 1 && testRiver(dr, dc));
  }

  return false;
}

export function attackSquaresForPiece(board: Board, piece: Piece, r: number, c: number, state?: GameState): [number, number][] {
  const moves: [number, number][] = [];
  const f = forwardDir(piece.side);
  const add = (nr: number, nc: number) => { if (inBounds(nr, nc)) moves.push([nr, nc] as [number, number]); };
  const promo = piece.promoted;
  const kind = piece.type;
  if (!promo) {
    if (kind === "king") { for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { if (dr===0&&dc===0) continue; for (let step=1;step<=2;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } } return moves; }
    if (kind === "queen") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as [number,number][]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } return moves; }
    if (kind === "general") { for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]] as [number,number][]) add(r+dr,c+dc); for (let i=1;i<=4;i++) { add(r+i,c+i); add(r+i,c-i); add(r-i,c+i); add(r-i,c-i); } return moves; }
    if (kind === "elephant") { for (const [dr,dc,mx] of [[f,0,2],[f,-1,1],[f,1,1],[-f,-1,2],[-f,1,2]] as [number,number,number][]) { for (let step=1;step<=mx;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; let blocked=false; for (let i=1;i<step;i++) { const tr=r+dr*i,tc=c+dc*i; if (!inBounds(tr,tc)||board[tr][tc]){blocked=true;break;} } if (blocked) break; add(nr,nc); } } return moves; }
    if (kind === "priest") { for (const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]] as [number,number][]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } add(r+f,c); add(r-f,c); return moves; }
    if (kind === "horse") { const clr = (p: [number,number][]) => { for (const [pr,pc] of p) if (!inBounds(pr,pc)||board[pr][pc]) return false; return true; }; const hm = [{d:[r+2,c+1] as [number,number],a:[[r+1,c],[r+2,c]] as [number,number][],b:[[r,c+1],[r+1,c+1]] as [number,number][]},{d:[r+2,c-1],a:[[r+1,c],[r+2,c]],b:[[r,c-1],[r+1,c-1]]},{d:[r-2,c+1],a:[[r-1,c],[r-2,c]],b:[[r,c+1],[r-1,c+1]]},{d:[r-2,c-1],a:[[r-1,c],[r-2,c]],b:[[r,c-1],[r-1,c-1]]},{d:[r+1,c+2],a:[[r,c+1],[r,c+2]],b:[[r+1,c],[r+1,c+1]]},{d:[r+1,c-2],a:[[r,c-1],[r,c-2]],b:[[r+1,c],[r+1,c-1]]},{d:[r-1,c+2],a:[[r,c+1],[r,c+2]],b:[[r-1,c],[r-1,c+1]]},{d:[r-1,c-2],a:[[r,c-1],[r,c-2]],b:[[r-1,c],[r-1,c-1]]}]; for (const m of hm) { const [nr,nc]=m.d; if (!inBounds(nr,nc)) continue; if (!clr(m.a)&&!clr(m.b)) continue; if (!board[nr][nc]||board[nr][nc].side!==piece.side) add(nr,nc); } return moves; }
    if (kind === "cannon") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) { let seen=0; for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; if (!board[nr][nc]){if(seen===0)add(nr,nc);continue;} seen++; if(seen===1)continue; if(seen===2&&board[nr][nc].side!==piece.side)add(nr,nc); break; } } return moves; }
    if (kind === "tower") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } return moves; }
    if (kind === "carriage") { for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as [number,number][]) for (let step=1;step<=(Math.abs(dr)+Math.abs(dc)===1?4:1);step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)||!isOwnSide(piece.side,nr)) break; add(nr,nc); } return moves; }
    if (kind === "archer") { if (onBank(piece.side,r)) { const row=r+f; for (const dc of [-1,0,1]) { const nc=c+dc; if (inBounds(row,nc)) add(row,nc); } } for (const [dr,dc] of [[3,1],[3,-1],[-3,1],[-3,-1],[1,3],[1,-3],[-1,3],[-1,-3]] as [number,number][]) { const nr=r+dr,nc=c+dc; if (!inBounds(nr,nc)||!isOwnSide(piece.side,nr)) continue; add(nr,nc); } return moves; }
    if (kind === "pawn") {
      const sk = (row: number) => isRiverSquare(row) ? row + f : row;
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
      }
      return moves;
    }
    if (kind === "crossbow") {
      const addWithRiverRule = (dr: number, dc: number) => {
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
      for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]] as [number,number][]) addWithRiverRule(dr, dc);
      addWithRiverRule(f, 0);
      return moves;
    }
  }
  if (promo) {
    if (kind === "elephant") {
      const addWithRiverRule = (dr: number, dc: number) => {
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
      const elDirs: [number,number][] = [[1,0],[-1,0],[0,1],[0,-1],[f,1],[f,-1],[2,0]];
      for (const [dr, dc] of elDirs) addWithRiverRule(dr, dc);
    }
    else if (kind === "horse") { for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { if (dr===0&&dc===0) continue; add(r+dr,c+dc); } for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]] as [number,number][]) add(r+dr,c+dc); }
    else if (kind === "priest") { for (const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]] as [number,number][]) for (let step=1;step<=4;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; } for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]] as [number,number][]) add(r+dr,c+dc); }
    else if (kind === "cannon") { for (const [dr,dc] of [[1,0],[-1,0],[1,1],[-1,-1]] as [number,number][]) { let seen=0; for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; if (!board[nr][nc]){if(seen===0)add(nr,nc);continue;} seen++; if (seen===2&&board[nr][nc].side!==piece.side) add(nr,nc); if (seen>=2) break; } } }
    else if (kind === "tower") for (const [dr,dc] of [[0,1],[0,-1],[-1,1],[1,-1]] as [number,number][]) for (let step=1;step<BOARD_SIZE;step++) { const nr=r+dr*step,nc=c+dc*step; if (!inBounds(nr,nc)) break; add(nr,nc); if (board[nr][nc]) break; }
    else if (kind === "pawn") {
      const addWithRiverRule = (dr: number, dc: number) => {
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
      const pawnDirs: [[number,number],[number,number],[number,number],[number,number]] = [[1,1],[1,-1],[-1,1],[-1,-1]];
      for (const drc of pawnDirs) addWithRiverRule(drc[0], drc[1]);
      addWithRiverRule(f, 0);
    }
  }
  return moves;
}

export function isSquareAttacked(board: Board, r: number, c: number, bySide: Side, state?: GameState): boolean {
  if (!board || !Array.isArray(board)) return false;

  for (let rr = 0; rr < BOARD_SIZE; rr++) {
    const row = board[rr];
    if (!row) continue;
    for (let cc = 0; cc < BOARD_SIZE; cc++) {
      const p = row[cc];
      if (!p || p.side !== bySide) continue;
      const attacks = attackSquaresForPiece(board, p, rr, cc, state);
      for (const move of attacks) {
        const ar = Array.isArray(move) ? move[0] : (move as any).r;
        const ac = Array.isArray(move) ? move[1] : (move as any).c;
        if (ar === r && ac === c) return true;
      }
    }
  }

  const kings = findKings(board);
  const enemyKing = kings[bySide];
  const myKing = kings[opponent(bySide)];
  if (enemyKing && myKing) {
    // FLYING GENERAL RULE: two kings can NEVER face each other on the same row,
    // column, or diagonal with no pieces between them, at ANY distance.
    const dr = Math.sign(myKing.r - enemyKing.r);
    const dc = Math.sign(myKing.c - enemyKing.c);
    const drAbs = Math.abs(myKing.r - enemyKing.r);
    const dcAbs = Math.abs(myKing.c - enemyKing.c);
    const sameRow = dr === 0 && dc !== 0;
    const sameCol = dc === 0 && dr !== 0;
    const sameDiag = dr !== 0 && dc !== 0 && drAbs === dcAbs;
    if (sameRow || sameCol || sameDiag) {
      const between = pathSquares(enemyKing.r, enemyKing.c, myKing.r, myKing.c);
      if (!between.some(([rr, cc]) => board[rr][cc])) return true;
    }
  }
  return false;
}

export function isKingInCheck(state: GameState, side: Side): boolean {
  const t = (dbg as any).perf.start('isKingInCheck');
  const board = state.board;
  const kings = findKings(board);
  const king = kings[side];
  if (!king) {
    dbg.rules.warn('King not found!', { side });
    (dbg as any).perf.end(t);
    return false;
  }
  const result = isSquareAttacked(board, king.r, king.c, opponent(side), state);
  if (result) (dbg as any).rules(`Check! ${side} king at ${king.r},${king.c} attacked`);
  (dbg as any).perf.end(t);
  return result;
}