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

// ── TranspositionTable with two-bucket aging ──────────────────────────────────
// ── OPT-TT: Replaced the previous sort-based eviction (O(n log n), blocking) with
// a two-bucket (generation) scheme inspired by Stockfish's TT design.
// How it works:
//   - The table is divided into two equal halves: buckets[0] and buckets[1].
//   - currentBucket alternates each time the table fills (every maxSize/2 inserts).
//   - New entries always go into currentBucket.
//   - When currentBucket is full, it is cleared entirely and currentBucket flips.
//     This amortizes eviction cost to O(1) per insert (occasional full-bucket clear
//     is O(maxSize/2) but that's the same total work spread differently).
//   - Lookups check both buckets so recently-flipped entries are still found.
//   - Depth-preferred replacement: on collision within the same bucket, keep the
//     entry with the higher depth (more valuable search result).
// Compared to the old design:
// OLD: [...map.entries()].sort() on every overflow → O(n log n), ~1ms stall
// NEW: bucket.clear() on flip → O(n/2), amortized O(1) per insert, no sort
// ES: Two-bucket aging para la tabla de transposición.
export class TranspositionTable {
  constructor(maxSize = 500_000) {
    this.maxSize       = maxSize;
    this.halfSize      = (maxSize / 2) | 0;
    this.buckets       = [new Map(), new Map()];
    this.currentBucket = 0;
    // Legacy .map accessor for size logging in bot.js
    // ES: Acceso legacy .map para logging en bot.js
    this.map = {
      get size() { return this._tt.buckets[0].size + this._tt.buckets[1].size; },
      _tt: this,
    };
  }

  get(key) {
    // Check current bucket first (most recent), then the other
    // ES: Buscar primero en el bucket actual (más reciente), luego en el otro
    return this.buckets[this.currentBucket].get(key)
        ?? this.buckets[this.currentBucket ^ 1].get(key)
        ?? undefined;
  }

  set(key, value) {
    const bucket = this.buckets[this.currentBucket];

    // Depth-preferred replacement: if the key already exists in the current bucket,
    // only overwrite if the new entry has equal or greater depth.
    // ES: Reemplazo preferente por profundidad: solo sobreescribir si la nueva
    // entrada tiene profundidad igual o mayor.
    const existing = bucket.get(key);
    if (existing && existing.depth > value.depth) return;

    bucket.set(key, value);

    // When current bucket is full, rotate to the other one
    // ES: Cuando el bucket actual está lleno, rotar al otro
    if (bucket.size >= this.halfSize) {
      this.currentBucket ^= 1;
      this.buckets[this.currentBucket].clear();
    }
  }
}