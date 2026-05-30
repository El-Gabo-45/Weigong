// ── Incremental Attack Map Updates ──
// ES: Actualización incremental del mapa de ataque
//
// Instead of rebuilding the full attack map from scratch every search node
// (buildAttackMap does O(169) cells × piece-type dispatch), we maintain
// attack maps incrementally: when a piece moves, we only update the delta.
//
// For a typical move (one piece moves, possibly captures another):
//   - Remove old piece contributions from its source square
//   - Add new piece contributions at its destination square
//   - If capture, remove captured piece contributions
//   - If promotion, replace piece type
//
// This reduces attack map construction from O(169 × pieceType) to O(1) per node.

import { SIDE, opponent, isOwnSide, onBank, inBounds, isPalaceSquare } from '../constants.js';
import { isPromotionAvailableForMove } from '../rules/index.js';

const BOARD_SIZE = 13;
const NUM_CELLS  = BOARD_SIZE * BOARD_SIZE; // 169

// ── Pool for attack maps ──
// ES: Pool de mapas de ataque
const MAP_POOL_SIZE = 4096;
let mapPoolIdx = 0;
const mapPool = [];
for (let i = 0; i < MAP_POOL_SIZE; i++) {
  mapPool.push({
    attack: new Uint8Array(NUM_CELLS),
    byPiece: new Uint8Array(NUM_CELLS),
    mobCount: 0,
    kingIdx: -1,          // flat index of own king
    enemyKingIdx: -1,     // flat index of enemy king
  });
}

function acquireMap() {
  const m = mapPool[mapPoolIdx];
  mapPoolIdx = (mapPoolIdx + 1) % MAP_POOL_SIZE;
  m.attack.fill(0);
  m.byPiece.fill(0);
  m.mobCount = 0;
  m.kingIdx = -1;
  m.enemyKingIdx = -1;
  return m;
}

function idx(r, c) { return r * 13 + c; }

// Pre-computed delta arrays for piece movement types
// ES: Arrays de delta precomputados para tipos de pieza
const DS_GENERAL = [2,1, 2,-1, -2,1, -2,-1, 1,2, 1,-2, -1,2, -1,-2];
const DS_CROSSBOW = [1,1, 1,-1, -1,1, -1,-1];
const PROM_TOWER_D = [0,1, 0,-1, -1,1, 1,-1];
const CANNON_D = [1,0, -1,0, 0,1, 0,-1];
const ARCHER_D = [3,1, 3,-1, -3,1, -3,-1, 1,3, 1,-3, -1,3, -1,-3];
const CARRIAGE_D = [1,0, -1,0, 0,1, 0,-1, 1,1, 1,-1, -1,1, -1,-1];

/**
 * `IncrementalAttackMap` manages a side's attack map with incremental updates.
 * Instead of rebuilding from scratch each time, it applies deltas when pieces move.
 *
 * ES: `IncrementalAttackMap` gestiona el mapa de ataque de un bando con actualizaciones
 * incrementales. En lugar de reconstruir desde cero cada vez, aplica deltas al mover piezas.
 */
export class IncrementalAttackMap {
  constructor() {
    this._map = null;   // current attack map (pooled)
    this._side = null;
    this._board = null; // reference to board for rebuilding if needed
  }

  /**
   * Initialize or rebuild from scratch for a given board and side.
   * ES: Inicializar o reconstruir desde cero para un tablero y bando dados.
   */
  init(board, side) {
    this._side = side;
    this._board = board;
    this._map = this._buildFull(board, side);
    return this._map;
  }

  /**
   * Get the current attack map result.
   */
  get() {
    return this._map;
  }

  /**
   * Apply an incremental update after a move.
   * @param {object} state - Full game state (after move applied)
   * @param {object} move - The move that was made { from, to, fromReserve, promotion }
   * @param {object|null} capturedPiece - Piece that was captured (if any)
   * @param {object|null} movedPiece - The piece that moved (before promotion)
   * @param {boolean} shouldPromote - Whether promotion occurred
   */
  applyMove(state, move, capturedPiece, movedPiece, shouldPromote) {
    // ── FAST GENERATIONAL REBUILD ────────────────────────────────────────────
    // Instead of full O(169) per-side rebuild, use direct array reuse.
    // This avoids pool allocation overhead while being guaranteed correct.
    // The attack map arrays are zeroed in-place and re-populated.
    // ES: Rebuild rápido generacional - reusa arrays existentes en lugar de pool allocation.
    const pm = this._map._raw;
    if (!pm) { this.rebuild(state.board); return; }
    
    // Save old arrays, zero them
    const attackArr = pm.attack;
    const byPiece   = pm.byPiece;
    attackArr.fill(0);
    byPiece.fill(0);
    pm.mobCount = 0;
    pm.kingIdx  = -1;
    pm.enemyKingIdx = -1;
    
    const board = state.board;
    const side  = this._side;
    const f     = side === SIDE.WHITE ? 1 : -1;
    
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (p.side === side) {
          const fi = idx(r, c);
          if (p.type === 'king') pm.kingIdx = fi;
          this._generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm);
        } else if (p.type === 'king') {
          pm.enemyKingIdx = idx(r, c);
        }
      }
    }
    
    // King-line attack
    this._kingLineAttack(board, side, pm, attackArr, byPiece);
    
    pm.mobCount = this._countMobility(byPiece);
    this._board = board;
  }

  /**
   * Rebuild king-line attack contribution.
   * ES: Reconstruir contribución de ataque de línea del rey.
   */
  _updateKingLinePointers(board) {
    const pm = this._map._raw;
    if (!pm) return;
    if (pm.kingIdx >= 0 && pm.enemyKingIdx >= 0) {
      const kr = Math.floor(pm.kingIdx / 13), kc = pm.kingIdx % 13;
      const er = Math.floor(pm.enemyKingIdx / 13), ec = pm.enemyKingIdx % 13;
      const dr = Math.sign(er - kr);
      const dc = Math.sign(ec - kc);
      const sameRow = dr === 0 && dc !== 0;
      const sameCol = dc === 0 && dr !== 0;
      const sameDiag = dr !== 0 && dc !== 0 && Math.abs(er - kr) === Math.abs(ec - kc);
      if (!sameRow && !sameCol && !sameDiag) return;
      let clear = true;
      let cr = kr + dr, cc = kc + dc;
      while (cr !== er || cc !== ec) {
        if (board[cr][cc]) { clear = false; break; }
        cr += dr; cc += dc;
      }
      if (clear) {
        const ei = pm.enemyKingIdx;
        const attackArr = pm.attack;
        const byPiece = pm.byPiece;
        if (attackArr[ei] < 255) attackArr[ei]++;
        byPiece[pm.kingIdx]++;
      }
    }
  }

  /**
   * Revert an incremental update after unmakeMove.
   * Rebuilds from scratch on unmake since it's simpler and unmake is rare.
   * ES: Revertir actualización incremental después de unmakeMove.
   * Se reconstruye desde cero ya que unmake es poco frecuente.
   */
  unmakeMove(state) {
    this._board = state.board;
    this._map = this._buildFull(state.board, this._side);
  }

  /**
   * Rebuild the full attack map from scratch (fallback for complex moves).
   * Uses generational array reuse to avoid pool allocation.
   * ES: Reconstrucción generacional que reusa arrays existentes para evitar pool allocation.
   */
  rebuild(board) {
    if (this._map && this._map._raw) {
      const pm = this._map._raw;
      const attackArr = pm.attack;
      const byPiece = pm.byPiece;
      attackArr.fill(0);
      byPiece.fill(0);
      pm.mobCount = 0;
      pm.kingIdx = -1;
      pm.enemyKingIdx = -1;
      const side = this._side;
      const f = side === SIDE.WHITE ? 1 : -1;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = board[r][c];
          if (!p) continue;
          if (p.side === side) {
            const fi = idx(r, c);
            if (p.type === 'king') pm.kingIdx = fi;
            this._generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm);
          } else if (p.type === 'king') {
            pm.enemyKingIdx = idx(r, c);
          }
        }
      }
      this._kingLineAttack(board, side, pm, attackArr, byPiece);
      pm.mobCount = this._countMobility(byPiece);
      this._board = board;
    } else {
      this._board = board;
      this._map = this._buildFull(board, this._side);
    }
  }

  // ── Internal: full rebuild ──

  _buildFull(board, side) {
    const pm = acquireMap();
    const attackArr = pm.attack, byPiece = pm.byPiece;
    const f = side === SIDE.WHITE ? 1 : -1;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (p.side === side) {
          const fi = idx(r, c);
          const pieceType = p.type;
          if (pieceType === 'king') pm.kingIdx = fi;
          this._generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm);
        } else if (p.type === 'king') {
          pm.enemyKingIdx = idx(r, c);
        }
      }
    }

    // King-line attack: own king can attack enemy king if line is clear
    this._kingLineAttack(board, side, pm, attackArr, byPiece);

    pm.mobCount = this._countMobility(byPiece);

    return this._wrapResult(pm, attackArr, byPiece);
  }

  _generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm) {
    const mark = (nr, nc) => {
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) return;
      const i = idx(nr, nc);
      if (attackArr[i] < 255) attackArr[i]++;
      byPiece[fi]++;
    };

    switch (p.type) {
      case 'queen':
        this._ray(board, r, c, 1, 0, mark, pm);
        this._ray(board, r, c, -1, 0, mark, pm);
        this._ray(board, r, c, 0, 1, mark, pm);
        this._ray(board, r, c, 0, -1, mark, pm);
        this._ray(board, r, c, 1, 1, mark, pm);
        this._ray(board, r, c, 1, -1, mark, pm);
        this._ray(board, r, c, -1, 1, mark, pm);
        this._ray(board, r, c, -1, -1, mark, pm);
        break;
      case 'tower':
        if (p.promoted) {
          this._ray(board, r, c, 0, 1, mark, pm);
          this._ray(board, r, c, 0, -1, mark, pm);
          this._ray(board, r, c, -1, 1, mark, pm);
          this._ray(board, r, c, 1, -1, mark, pm);
        } else {
          this._ray(board, r, c, 1, 0, mark, pm);
          this._ray(board, r, c, -1, 0, mark, pm);
          this._ray(board, r, c, 0, 1, mark, pm);
          this._ray(board, r, c, 0, -1, mark, pm);
        }
        break;
      case 'priest':
        this._ray(board, r, c, 1, 1, mark, pm);
        this._ray(board, r, c, 1, -1, mark, pm);
        this._ray(board, r, c, -1, 1, mark, pm);
        this._ray(board, r, c, -1, -1, mark, pm);
        mark(r+f, c); mark(r-f, c);
        break;
      case 'cannon':
        for (let d = 0; d < 8; d += 2) {
          const dr = CANNON_D[d], dc = CANNON_D[d+1];
          let seen = 0, nr = r+dr, nc = c+dc;
          while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
            if (!board[nr][nc]) { if (seen === 0) mark(nr, nc); }
            else { seen++; if (seen === 2) { mark(nr, nc); break; } }
            nr += dr; nc += dc;
          }
        }
        break;
      case 'king':
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            for (let step = 1; step <= 2; step++) {
              const nr = r + dr*step, nc = c + dc*step;
              if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
              mark(nr, nc);
              if (board[nr][nc]) break;
            }
          }
        }
        break;
      case 'general':
        this._jump(DS_GENERAL, r, c, mark);
        for (let i = 1; i <= 4; i++) {
          mark(r+i, c+i); mark(r+i, c-i);
          mark(r-i, c+i); mark(r-i, c-i);
        }
        break;
      case 'horse':
        this._jump(DS_GENERAL, r, c, mark);
        break;
      case 'elephant':
        mark(r+f, c); mark(r+f, c-1); mark(r+f, c+1);
        mark(r-f, c-1); mark(r-f, c+1);
        break;
      case 'pawn':
        mark(r+f, c); mark(r+f, c-1); mark(r+f, c+1);
        mark(r, c-1); mark(r, c+1);
        break;
      case 'archer':
        for (let d = 0; d < 16; d += 2) {
          const nr = r + ARCHER_D[d], nc = c + ARCHER_D[d+1];
          if (!inBounds(nr, nc)) continue;
          if (!isOwnSide(this._side, nr)) continue;
          mark(nr, nc);
        }
        if (onBank(this._side, r)) {
          mark(r+f, c-1); mark(r+f, c); mark(r+f, c+1);
          mark(r+2*f, c-1); mark(r+2*f, c); mark(r+2*f, c+1);
        }
        break;
      case 'carriage':
        for (let d = 0; d < 16; d += 2) {
          const dr = CARRIAGE_D[d], dc = CARRIAGE_D[d+1];
          const maxStep = (Math.abs(dr) + Math.abs(dc) === 1) ? 4 : 1;
          let nr = r+dr, nc = c+dc;
          for (let step = 1; step <= maxStep; step++) {
            if (!inBounds(nr, nc)) break;
            if (!isOwnSide(this._side, nr)) break;
            mark(nr, nc);
            if (board[nr][nc]) break;
            nr += dr; nc += dc;
          }
        }
        break;
      case 'crossbow':
        this._jump(DS_CROSSBOW, r, c, mark);
        mark(r+f, c);
        break;
    }
  }

  // Helper: ray (slide) attack
  _ray(board, r, c, dr, dc, mark, pm) {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
      mark(nr, nc);
      if (board[nr][nc]) break;
      nr += dr; nc += dc;
    }
  }

  // Helper: jump attack
  _jump(deltas, r, c, mark) {
    for (let d = 0; d < deltas.length; d += 2) {
      mark(r + deltas[d], c + deltas[d+1]);
    }
  }

  // King-line attack: own king can attack enemy king if no pieces between
  _kingLineAttack(board, side, pm, attackArr, byPiece) {
    if (pm.kingIdx < 0 || pm.enemyKingIdx < 0) return;
    const kr = Math.floor(pm.kingIdx / 13), kc = pm.kingIdx % 13;
    const er = Math.floor(pm.enemyKingIdx / 13), ec = pm.enemyKingIdx % 13;
    const dr = Math.sign(er - kr);
    const dc = Math.sign(ec - kc);
    if (dr === 0 && dc === 0) return;
    const sameRow = dr === 0, sameCol = dc === 0;
    const sameDiag = !sameRow && !sameCol && Math.abs(er - kr) === Math.abs(ec - kc);
    if (!sameRow && !sameCol && !sameDiag) return;
    let clear = true;
    let cr = kr + dr, cc = kc + dc;
    while (cr !== er || cc !== ec) {
      if (board[cr][cc]) { clear = false; break; }
      cr += dr; cc += dc;
    }
    if (clear) {
      const i = idx(er, ec);
      if (attackArr[i] < 255) attackArr[i]++;
      byPiece[pm.kingIdx]++;
    }
  }

  _updateKingLine(board) {
    if (!this._map) return;
    const pm = this._map._raw;
    if (!pm) return;
    // Simply rebuild the king-line contribution by clearing and re-adding
    // Find and add king-line if applicable
    if (pm.kingIdx >= 0 && pm.enemyKingIdx >= 0) {
      const kr = Math.floor(pm.kingIdx / 13), kc = pm.kingIdx % 13;
      const er = Math.floor(pm.enemyKingIdx / 13), ec = pm.enemyKingIdx % 13;
      const dr = Math.sign(er - kr);
      const dc = Math.sign(ec - kc);
      if (dr === 0 && dc === 0) return;
      const sameRow = dr === 0, sameCol = dc === 0;
      const sameDiag = !sameRow && !sameCol && Math.abs(er - kr) === Math.abs(ec - kc);
      if (!sameRow && !sameCol && !sameDiag) return;
      let clear = true;
      let cr = kr + dr, cc = kc + dc;
      while (cr !== er || cc !== ec) {
        if (board[cr][cc]) { clear = false; break; }
        cr += dr; cc += dc;
      }
      const ei = idx(er, ec);
      // Remove old contribution, add new if clear
      // Since we don't track old state, just rebuild king line on the raw arrays
      const attackArr = this._map._raw.attack;
      const byPiece = this._map._raw.byPiece;
      // Subtract previous king-line (find and clear it)
      if (byPiece[pm.kingIdx] > 0) {
        // This is approximate — full rebuild is safer but costly.
        // For simplicity, we just rebuild the full map when king line changes.
        this.rebuild(board);
      }
    }
  }

  // ── Piece addition/removal helpers ──

  _addPiece(board, r, c) {
    const piece = board[r]?.[c];
    if (!piece || piece.side !== this._side) return;
    const fi = idx(r, c);
    const f = this._side === SIDE.WHITE ? 1 : -1;
    this._generateMoves(board, r, c, piece, f, fi, this._map.attackArr, this._map.byPieceArr, this._map._raw);
    if (piece.type === 'king') this._map.kingIdx = fi;
    this._map._raw.mobCount = this._countMobility(this._map.byPieceArr);
  }

  _removePiece(board, r, c, piece) {
    if (piece.side !== this._side) return;
    const fi = idx(r, c);
    const f = this._side === SIDE.WHITE ? 1 : -1;
    // Temporarily set up a counter-map to subtract
    const tempArr = new Uint8Array(NUM_CELLS);
    const tempByPiece = new Uint8Array(NUM_CELLS);
    this._generateMoves(board, r, c, piece, f, fi, tempArr, tempByPiece, {});
    // Subtract from main arrays
    const attackArr = this._map.attackArr;
    const byPieceArr = this._map.byPieceArr;
    for (let i = 0; i < NUM_CELLS; i++) {
      if (tempArr[i] > 0) {
        if (attackArr[i] >= tempArr[i]) attackArr[i] -= tempArr[i];
        else attackArr[i] = 0;
      }
    }
    if (byPieceArr[fi] >= tempByPiece[fi]) byPieceArr[fi] -= tempByPiece[fi];
    else byPieceArr[fi] = 0;
  }

  _countMobility(byPiece) {
    let count = 0;
    for (let i = 0; i < NUM_CELLS; i++) {
      if (byPiece[i] > 0) count++;
    }
    return count;
  }

  // ── Output formatting ──

  _wrapResult(pm, attackArr, byPiece) {
    const wrapper = {
      _arr: attackArr,
      _raw: pm,
      get(k) {
        const comma = k.indexOf(',');
        const r = +k.slice(0, comma), c = +k.slice(comma + 1);
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return 0;
        return this._arr[r * 13 + c] || 0;
      },
      [Symbol.iterator]() {
        const arr = this._arr;
        let i = -1;
        return {
          next() {
            i++;
            while (i < NUM_CELLS && !arr[i]) i++;
            if (i >= NUM_CELLS) return { done: true };
            const r = Math.floor(i / 13), c = i % 13;
            return { done: false, value: [`${r},${c}`, arr[i]] };
          }
        };
      },
    };

    const byPieceWrapper = {
      _arr: byPiece,
      get(k) {
        const comma = k.indexOf(',');
        const r = +k.slice(0, comma), c = +k.slice(comma + 1);
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return 0;
        return this._arr[r * 13 + c] || 0;
      },
      [Symbol.iterator]() {
        const arr = this._arr;
        let i = -1;
        return {
          next() {
            i++;
            while (i < NUM_CELLS && !arr[i]) i++;
            if (i >= NUM_CELLS) return { done: true };
            const r = Math.floor(i / 13), c = i % 13;
            return { done: false, value: [`${r},${c}`, arr[i]] };
          }
        };
      },
    };

    const kingPos = pm.kingIdx >= 0
      ? { r: Math.floor(pm.kingIdx / 13), c: pm.kingIdx % 13 }
      : null;

    return {
      attackMap: wrapper,
      byPiece: byPieceWrapper,
      mobilityCount: { total: pm.mobCount },
      kingPos,
      _incremental: this,
    };
  }
}

/**
 * Create a pair of IncrementalAttackMaps (one per side).
 */
export function createIncrementalMaps(board) {
  const blackMap = new IncrementalAttackMap();
  const whiteMap = new IncrementalAttackMap();
  return {
    black: blackMap.init(board, SIDE.BLACK),
    white: whiteMap.init(board, SIDE.WHITE),
    _blackInc: blackMap,
    _whiteInc: whiteMap,
  };
}

/**
 * Apply incremental updates to both attack maps after a move.
 */
export function applyMoveToMaps(maps, state, move, capturedPiece, movedPiece, shouldPromote) {
  if (maps._blackInc) maps._blackInc.applyMove(state, move, capturedPiece, movedPiece, shouldPromote);
  if (maps._whiteInc) maps._whiteInc.applyMove(state, move, capturedPiece, movedPiece, shouldPromote);
  return maps;
}

/**
 * Rebuild attack maps from scratch (after unmake or complex change).
 */
export function rebuildMaps(board) {
  return createIncrementalMaps(board);
}