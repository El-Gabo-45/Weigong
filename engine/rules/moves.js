import { BOARD_SIZE, SIDE, forwardDir, onBank, isOwnSide, inBounds, isRiverSquare, opponent } from '../constants.js';
import { isPalaceCursedFor } from './state.js';
import { isSquareProtectedByArcher } from './archer.js';
import { isKingInCheck } from './check.js';

export function addIfValid(moves, board, piece, fromR, fromC, toR, toC, opts = {}) {
  if (!inBounds(toR, toC)) return;
  const target = board[toR][toC];
  if (target && target.side === piece.side && !opts.canCaptureOwn) return;
  moves.push({
    r: toR,
    c: toC,
    capture: Boolean(target && target.side !== piece.side),
    special: opts.special ?? null,
  });
}

export function rayMoves(board, piece, r, c, dirs, maxSteps = 99, opts = {}) {
  const moves = [];
  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= maxSteps; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      if (opts.noCrossRiver && !isOwnSide(piece.side, nr)) break;
      const target = board[nr][nc];
      if (!target) {
        moves.push({ r: nr, c: nc, capture: false });
        continue;
      }
      if (target.side !== piece.side) moves.push({ r: nr, c: nc, capture: true });
      break;
    }
  }
  return moves;
}

export function jumpMoves(board, piece, r, c, deltas, opts = {}) {
  const moves = [];
  for (const [dr, dc] of deltas) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    if (opts.noCrossRiver && !isOwnSide(piece.side, nr)) continue;
    const target = board[nr][nc];
    if (target && target.side === piece.side) continue;
    moves.push({ r: nr, c: nc, capture: Boolean(target && target.side !== piece.side) });
  }
  return moves;
}


export function pseudoMovesForPiece(board, piece, r, c, state) {
  const kind = piece.type;
  const f = forwardDir(piece.side);
  const moves = [];
  const cursed = state && isPalaceCursedFor(state, piece.side);

  const push = (nr, nc) => {
    if (!inBounds(nr, nc)) return;
    const target = board[nr][nc];
    if (target && target.side === piece.side) return;
    moves.push({ r: nr, c: nc, capture: Boolean(target && target.side !== piece.side) });
  };

  if (!piece.promoted) {
    if (kind === "king") {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (cursed && dr !== 0 && dc !== 0) continue;
          for (let step = 1; step <= 2; step++) {
            const nr = r + dr * step, nc = c + dc * step;
            if (!inBounds(nr, nc)) break;
            push(nr, nc);
            if (board[nr][nc]) break;
          }
        }
      }
      return moves;
    }

    if (kind === "queen") {
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        if (cursed && (dr === 0 || dc === 0)) continue;
        for (let step = 1; step < BOARD_SIZE; step++) {
          const nr = r + dr * step, nc = c + dc * step;
          if (!inBounds(nr, nc)) break;
          const target = board[nr][nc];
          if (target && target.side === piece.side) break;
          moves.push({ r: nr, c: nc, capture: Boolean(target && target.side !== piece.side) });
          if (target) break;
        }
      }
      return moves;
    }

    if (kind === "general") {
      for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) push(r + dr, c + dc);
      for (let i = 1; i <= 4; i++) { push(r + i, c + i); push(r + i, c - i); push(r - i, c + i); push(r - i, c - i); }
      return moves;
    }

    if (kind === "elephant") {
      for (const [dr, dc, maxStep] of [[f, 0, 2], [f, -1, 1], [f, 1, 1], [-f, -1, 2], [-f, 1, 2]]) {
        for (let step = 1; step <= maxStep; step++) {
          const nr = r + dr * step, nc = c + dc * step;
          if (!inBounds(nr, nc)) break;
          let blocked = false;
          for (let i = 1; i < step; i++) { const tr = r + dr*i, tc = c + dc*i; if (!inBounds(tr, tc) || board[tr][tc]) { blocked = true; break; } }
          if (blocked) break;
          push(nr, nc);
        }
      }
      return moves;
    }

    if (kind === "priest") {
      for (const m of rayMoves(board, piece, r, c, [[1,1],[1,-1],[-1,1],[-1,-1]])) moves.push(m);
      push(r + f, c); push(r - f, c);
      return moves;
    }

    if (kind === "horse") {
      const isPathClear = (path) => { for (const [pr, pc] of path) { if (!inBounds(pr, pc) || board[pr][pc]) return false; } return true; };
      const horseMoves = [
        { dest: [r+2, c+1], pathA: [[r+1, c], [r+2, c]], pathB: [[r, c+1], [r+1, c+1]] },
        { dest: [r+2, c-1], pathA: [[r+1, c], [r+2, c]], pathB: [[r, c-1], [r+1, c-1]] },
        { dest: [r-2, c+1], pathA: [[r-1, c], [r-2, c]], pathB: [[r, c+1], [r-1, c+1]] },
        { dest: [r-2, c-1], pathA: [[r-1, c], [r-2, c]], pathB: [[r, c-1], [r-1, c-1]] },
        { dest: [r+1, c+2], pathA: [[r, c+1], [r, c+2]], pathB: [[r+1, c], [r+1, c+1]] },
        { dest: [r+1, c-2], pathA: [[r, c-1], [r, c-2]], pathB: [[r+1, c], [r+1, c-1]] },
        { dest: [r-1, c+2], pathA: [[r, c+1], [r, c+2]], pathB: [[r-1, c], [r-1, c+1]] },
        { dest: [r-1, c-2], pathA: [[r, c-1], [r, c-2]], pathB: [[r-1, c], [r-1, c-1]] },
      ];
      for (const move of horseMoves) {
        const [nr, nc] = move.dest;
        if (!inBounds(nr, nc)) continue;
        if (!isPathClear(move.pathA) && !isPathClear(move.pathB)) continue;
        push(nr, nc);
      }
      return moves;
    }

    if (kind === "cannon") {
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        let seen = 0;
        for (let step = 1; step < BOARD_SIZE; step++) {
          const nr = r + dr * step, nc = c + dc * step;
          if (!inBounds(nr, nc)) break;
          const target = board[nr][nc];
          if (!target) { if (seen === 0) moves.push({ r: nr, c: nc, capture: false }); continue; }
          seen++;
          if (seen === 2 && target.side !== piece.side) moves.push({ r: nr, c: nc, capture: true });
          if (seen >= 2) break;
        }
      }
      return moves;
    }

    if (kind === "tower") return rayMoves(board, piece, r, c, [[1,0],[-1,0],[0,1],[0,-1]]);

    if (kind === "carriage") {
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]) {
        for (let step = 1; step <= (Math.abs(dr) + Math.abs(dc) === 1 ? 4 : 1); step++) {
          const nr = r + dr * step, nc = c + dc * step;
          if (!inBounds(nr, nc) || !isOwnSide(piece.side, nr)) break;
          push(nr, nc);
        }
      }
      return moves;
    }

    if (kind === "archer") {
      if (onBank(piece.side, r)) { const row = r + f; for (const dc of [-1, 0, 1]) push(row, c + dc); }
      for (const [dr, dc] of [[3,1],[3,-1],[-3,1],[-3,-1],[1,3],[1,-3],[-1,3],[-1,-3]]) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc) || !isOwnSide(piece.side, nr)) continue;
        push(nr, nc);
      }
      return moves;
    }

    if (kind === "pawn") {
      const skip = (row) => isRiverSquare(row) ? row + f : row;
      let nr = skip(r + f);
      if (inBounds(nr, c) && !board[nr][c]) push(nr, c);
      let nd = skip(r + f);
      if (inBounds(nd, c-1)) { const t = board[nd][c-1]; if (t && t.side !== piece.side) push(nd, c-1); }
      if (inBounds(nd, c+1)) { const t = board[nd][c+1]; if (t && t.side !== piece.side) push(nd, c+1); }
      if (isOwnSide(piece.side, r)) {
        if (inBounds(r, c-1)) { const t = board[r][c-1]; if (t && t.side !== piece.side) push(r, c-1); }
        if (inBounds(r, c+1)) { const t = board[r][c+1]; if (t && t.side !== piece.side) push(r, c+1); }
      }
      if (!isOwnSide(piece.side, r)) {
        if (inBounds(r, c-1)) { const t = board[r][c-1]; if (!t || t.side !== piece.side) push(r, c-1); }
        if (inBounds(r, c+1)) { const t = board[r][c+1]; if (!t || t.side !== piece.side) push(r, c+1); }
        for (const [dr, dc] of [[f,1],[f,-1]]) {
          const nr2 = r + dr, nc2 = c + dc;
          if (inBounds(nr2, nc2)) { const t = board[nr2][nc2]; if (t && t.side !== piece.side) push(nr2, nc2); }
        }
      }
      return moves;
    }

    if (kind === "crossbow") {
      // River-skip with blocking/capture:
      // - if the adjacent destination is the river row:
      //   - if occupied: can capture it (if enemy) and cannot go beyond
      //   - if empty: may go one more square in same direction (and capture there)
      const pushWithRiverRule = (dr, dc) => {
        const step1r = r + dr;
        const step1c = c + dc;
        if (!inBounds(step1r, step1c)) return;
        if (isRiverSquare(step1r)) {
          const mid = board[step1r][step1c];
          // No piece can ever end on the river: if blocked, stop.
          if (mid) return;
          // Jump over the river: advance row again, keep same column offset (no double-dc).
          const step2r = step1r + dr;
          const step2c = step1c;
          if (!inBounds(step2r, step2c)) return;
          const t = board[step2r][step2c];
          if (t && t.side === piece.side) return;
          moves.push({ r: step2r, c: step2c, capture: Boolean(t && t.side !== piece.side) });
          return;
        }
        push(step1r, step1c);
      };
      
      // Movement: One square forward
      pushWithRiverRule(f, 0);

      // Movement: One square in all diagonals
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        pushWithRiverRule(dr, dc);
      }
      return moves;
    }
  } else {
    if (kind === "elephant") {
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2,0]]) push(r + dr, c + dc);
    } else if (kind === "horse") {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (dr === 0 && dc === 0) continue; push(r + dr, c + dc); }
      for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) push(r + dr, c + dc);
    } else if (kind === "priest") {
      for (const m of rayMoves(board, piece, r, c, [[1,1],[1,-1],[-1,1],[-1,-1]], 4)) moves.push(m);
      for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) push(r + dr, c + dc);
    } else if (kind === "cannon") {
      for (const m of rayMoves(board, piece, r, c, [[1,0],[-1,0]])) moves.push(m);
      for (const [dr, dc] of [[1,1],[-1,-1]]) {
        let seen = 0;
        for (let step = 1; step < BOARD_SIZE; step++) {
          const nr = r + dr*step, nc = c + dc*step;
          if (!inBounds(nr, nc)) break;
          const target = board[nr][nc];
          if (!target) { if (seen === 0) moves.push({ r: nr, c: nc, capture: false }); continue; }
          seen++;
          if (seen === 2 && target.side !== piece.side) moves.push({ r: nr, c: nc, capture: true });
          if (seen >= 2) break;
        }
      }
    } else if (kind === "tower") {
      for (const [dr, dc] of [[0,1],[0,-1],[-1,1],[1,-1]]) for (let step = 1; step <= 99; step++) {
        const nr = r + dr*step, nc = c + dc*step;
        if (!inBounds(nr, nc)) break;
        const target = board[nr][nc];
        if (target) { if (target.side !== piece.side) push(nr, nc); break; }
        push(nr, nc);
      }
    } else if (kind === "pawn") {
      // Promoted pawn (now crossbow) moves
      const pushWithRiverRule = (dr, dc) => {
        const step1r = r + dr;
        const step1c = c + dc;
        if (!inBounds(step1r, step1c)) return;
        if (isRiverSquare(step1r)) {
          const mid = board[step1r][step1c];
          if (mid) return;
          const step2r = step1r + dr;
          const step2c = step1c;
          if (!inBounds(step2r, step2c)) return;
          const t = board[step2r][step2c];
          if (t && t.side === piece.side) return;
          moves.push({ r: step2r, c: step2c, capture: Boolean(t && t.side !== piece.side) });
          return;
        }
        push(step1r, step1c);
      };
      
      // Movement: One square forward
      pushWithRiverRule(f, 0);

      // Movement: One square in all diagonals
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        pushWithRiverRule(dr, dc);
      }
      return moves;
    }
  }

  return moves;
}

export function getLegalMovesForSquare(state, r, c) {
  const board = state.board;
  const piece = board[r]?.[c];
  if (!piece) return [];

  let moves = pseudoMovesForPiece(board, piece, r, c, state);

  if (['archer', 'carriage'].includes(piece.type)) {
    moves = moves.filter(m => isOwnSide(piece.side, m.r));
  }

  // River squares are "dead": no piece may ever end a move on the river row.
  moves = moves.filter(m => !isRiverSquare(m.r));

  // Crossbow now can cross the river (no restrictions for crossbow)
  moves = moves.filter(m => {
    const target = board[m.r][m.c];
    if (target && target.side === piece.side) return false;
    return true;
  });
  moves = moves.filter(m => {
    if (isSquareProtectedByArcher(board, m.r, m.c, opponent(piece.side))) return false;
    return true;
  });

  const legal = [];
  const origFrom = board[r][c];
  for (const move of moves) {
    const origTo = board[move.r][move.c];
    board[r][c] = null;
    board[move.r][move.c] = piece;
    const inCheck = isKingInCheck(state, piece.side);
    board[r][c] = origFrom;
    board[move.r][move.c] = origTo;
    if (!inCheck) legal.push(move);
  }

  return legal;
}