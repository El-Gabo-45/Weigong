import { SIDE } from '../constants.js';

const MASK64 = (1n << 64n) - 1n;

export const PIECE_TYPES = ['king','queen','general','elephant','priest','horse',
                            'cannon','tower','carriage','archer','pawn','crossbow'];
export const SIDE_INDEX  = new Map([[SIDE.WHITE, 0], [SIDE.BLACK, 1]]);
export const PIECE_INDEX = new Map(PIECE_TYPES.map((t,i) => [t,i]));

export const ZobristTable = (() => {
  let seed = 0xDEADBEEFn;
  const next = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK64;
    return seed;
  };
  const t = [];
  for (let r = 0; r < 13; r++) {
    t[r] = [];
    for (let c = 0; c < 13; c++) {
      t[r][c] = [];
      for (let s = 0; s < 2; s++) {
        t[r][c][s] = [];
        for (let p = 0; p < PIECE_TYPES.length; p++)
          t[r][c][s][p] = [next(), next()];
      }
    }
  }
  return t;
})();

export const ZobristReserve = (() => {
  let seed = 0xCAFEBABEn;
  const next = () => {
    seed = (seed * 2862933555777941757n + 3037000493n) & MASK64;
    return seed;
  };
  const t = [];
  for (let s = 0; s < 2; s++) {
    t[s] = [];
    for (let p = 0; p < PIECE_TYPES.length; p++) {
      t[s][p] = [];
      for (let cnt = 0; cnt <= 13; cnt++) t[s][p][cnt] = next();
    }
  }
  return t;
})();

export const ZobristTurn        = [0xABCDEF01n, 0x12345678n];
export const ZobristPalaceWhite = 0xF00DBABEn;
export const ZobristPalaceBlack = 0xDEAD1234n;

export function xorPiece(hash, r, c, piece) {
  const si = SIDE_INDEX.get(piece.side);
  const ti = PIECE_INDEX.get(piece.type);
  if (si === undefined || ti === undefined) return hash;
  return hash ^ ZobristTable[r][c][si][ti][piece.promoted ? 1 : 0];
}

export function xorReserves(hash, reserves, sideIdx) {
  const counts = new Map();
  for (const p of reserves) {
    if (!p?.type) continue;
    counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  }
  for (const [type, cnt] of counts) {
    const ti = PIECE_INDEX.get(type);
    if (ti !== undefined) hash ^= ZobristReserve[sideIdx][ti][Math.min(cnt, 13)];
  }
  return hash;
}

export function computeFullHash(state) {
  let h = 0n;
  for (let r = 0; r < 13; r++)
    for (let c = 0; c < 13; c++) {
      const p = state.board[r][c];
      if (p) h = xorPiece(h, r, c, p);
    }
  h = xorReserves(h, state.reserves.white, 0);
  h = xorReserves(h, state.reserves.black, 1);
  h ^= ZobristTurn[state.turn === SIDE.WHITE ? 0 : 1];
  if (state.palaceTaken?.white) h ^= ZobristPalaceWhite;
  if (state.palaceTaken?.black) h ^= ZobristPalaceBlack;
  return h;
}

export class TranspositionTable {
  constructor(maxSize = 500_000) {
    this.map     = new Map();
    this.maxSize = maxSize;
    this.age     = 0;
  }
  get(key) {
    const e = this.map.get(key);
    if (e) e.age = this.age++;
    return e;
  }
  set(key, value) {
    if (this.map.size >= this.maxSize) {
      const toRemove = Math.floor(this.maxSize * 0.1);
      const entries  = [...this.map.entries()].sort((a,b) => a[1].age - b[1].age);
      for (let i = 0; i < toRemove; i++) this.map.delete(entries[i][0]);
    }
    this.map.set(key, { ...value, age: this.age++ });
  }
}
