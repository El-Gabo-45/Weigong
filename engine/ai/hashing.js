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

// ── TranspositionTable with Uint32Array-based hash table ─────────────────────
// OPT-TT-UINT32: Uses Uint32Array for compact storage with open addressing.
// Each entry stores: hash (lower 32 bits), score (packed), depth/flag, bestMove
// This reduces memory from ~200 bytes/entry (Map) to ~16 bytes/entry (Uint32Array).
// ES: Tabla de transposición con Uint32Array para almacenamiento compacto.
// Cada entrada: hash (32 bits inferiores), score (empaquetado), depth/flag, bestMove
// Esto reduce memoria de ~200 bytes/entrada (Map) a ~16 bytes/entrada (Uint32Array).

const TT_ENTRY_SIZE = 4; // 4 x Uint32 per entry
const TT_HASH  = 0;
const TT_SCORE = 1;
const TT_DEPTH_FLAG = 2;
const TT_MOVE  = 3;

const TT_FLAG_EXACT = 0;
const TT_FLAG_ALPHA = 1;
const TT_FLAG_BETA  = 2;

export class TranspositionTable {
  constructor(maxSize = 500_000) {
    this.maxSize = maxSize;
    // Round to power of 2 for fast modulo via bitmask
    this.size = 1;
    while (this.size < maxSize) this.size <<= 1;
    this.mask = this.size - 1;
    // Main storage: Uint32Array with 4 values per entry
    this.data = new Uint32Array(this.size * TT_ENTRY_SIZE);
    // Generation marker for aging
    this.generation = 0;
    this.genArray = new Uint8Array(this.size);
    this.count = 0;
    // Legacy .map accessor for size logging in bot.js
    this.map = {
      get size() { return this.count; },
      _tt: this,
    };
  }

  _probe(hashLo) {
    const mask = this.mask;
    let idx = hashLo & mask;
    let gen = this.genArray[idx];
    if (gen === this.generation && this.data[idx * TT_ENTRY_SIZE + TT_HASH] === hashLo) {
      return idx;
    }
    // Linear probing
    let probe = 1;
    while (true) {
      idx = (hashLo + probe) & mask;
      gen = this.genArray[idx];
      if (gen !== this.generation || this.data[idx * TT_ENTRY_SIZE + TT_HASH] === hashLo) {
        return idx;
      }
      probe++;
      if (probe > this.size) return -1; // Table full
    }
  }

  get(key) {
    // key is a BigInt hash - use lower 32 bits for probing
    const hashLo = Number(key & 0xFFFFFFFFn);
    const idx = this._probe(hashLo);
    if (idx < 0) return undefined;
    const base = idx * TT_ENTRY_SIZE;
    const storedHash = this.data[base + TT_HASH];
    if (storedHash !== hashLo) return undefined;
    
    // Unpack score (stored as signed 32-bit)
    const scorePacked = this.data[base + TT_SCORE];
    const score = scorePacked | 0; // Convert to signed
    const depthFlag = this.data[base + TT_DEPTH_FLAG];
    const depth = (depthFlag >> 2) & 0x3F;
    const flag = depthFlag & 0x3;
    const bestMoveKey = this.data[base + TT_MOVE];
    
    return { depth, score, flag, bestMoveKey };
  }

  set(key, value) {
    const hashLo = Number(key & 0xFFFFFFFFn);
    const idx = this._probe(hashLo);
    if (idx < 0) return; // Table full
    
    const base = idx * TT_ENTRY_SIZE;
    
    // Check if existing entry has higher depth
    const existingGen = this.genArray[idx];
    if (existingGen === this.generation && this.data[base + TT_HASH] === hashLo) {
      const existingDepth = (this.data[base + TT_DEPTH_FLAG] >> 2) & 0x3F;
      if (existingDepth > value.depth) return;
    } else {
      this.count++;
    }
    
    // Pack and store
    this.data[base + TT_HASH] = hashLo;
    this.data[base + TT_SCORE] = value.score | 0; // Pack as signed
    this.data[base + TT_DEPTH_FLAG] = ((value.depth & 0x3F) << 2) | (value.flag & 0x3);
    this.data[base + TT_MOVE] = value.bestMoveKey || 0;
    this.genArray[idx] = this.generation;
    
    // Rotate generation if table is getting full
    if (this.count > this.size * 0.9) {
      this.generation = (this.generation + 1) & 0xFF;
      if (this.generation === 0) {
        // Full cycle completed, clear old generation entries
        this.genArray.fill(0);
        this.count = 0;
      }
    }
  }
  
  // Export constants for use by search.js
  static get TT_EXACT() { return TT_FLAG_EXACT; }
  static get TT_ALPHA() { return TT_FLAG_ALPHA; }
  static get TT_BETA()  { return TT_FLAG_BETA; }
  
  approximateSize() {
    return this.count;
  }
}

// Re-export constants for backward compatibility
export const TT_EXACT = TT_FLAG_EXACT;
export const TT_ALPHA = TT_FLAG_ALPHA;
export const TT_BETA  = TT_FLAG_BETA;
