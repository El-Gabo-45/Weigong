// ── SharedArrayBuffer-based Transposition Table ──
// ES: Tabla de transposición basada en SharedArrayBuffer
// Designed for cross-worker sharing via SharedArrayBuffer + Atomics
// Each entry: 24 bytes = hash(8B) + score(4B) + depth(2B) + flags(1B) + bestMoveKey(4B) + padding(5B)
// Total slots = bufferSize / 24
// ES: Diseñado para compartir entre workers via SharedArrayBuffer + Atomics

const ENTRY_SIZE = 24; // bytes per entry
const HASH_OFF     = 0;  // BigUint64 (8 bytes)
const SCORE_OFF    = 8;  // Int32     (4 bytes)
const DEPTH_OFF    = 12; // Int16     (2 bytes)
const FLAGS_OFF    = 14; // Uint8     (1 byte)
const BMKEY_OFF    = 15; // Uint32    (4 bytes)
// padding from 19 to 24

const TT_EXACT = 0, TT_ALPHA = 1, TT_BETA = 2;

function align64(size) {
  // Align up to 64-byte boundary to prevent false sharing
  // ES: Alinear a 64 bytes para evitar false sharing
  return Math.ceil(size / 64) * 64;
}

export class SharedTT {
  /**
   * @param {number} maxEntries - Maximum number of TT entries
   * @param {SharedArrayBuffer} [existingBuffer] - Optional existing buffer to attach to
   */
  constructor(maxEntries = 500_000, existingBuffer = null) {
    this.maxEntries = maxEntries;
    this.entrySize  = ENTRY_SIZE;
    this.bufferSize = align64(maxEntries * ENTRY_SIZE + 8); // +8 for generation counter

    if (existingBuffer) {
      this.buffer = existingBuffer;
    } else {
      this.buffer = new SharedArrayBuffer(this.bufferSize);
    }

    this.uint8  = new Uint8Array(this.buffer);
    this.int32  = new Int32Array(this.buffer);
    this.uint32 = new Uint32Array(this.buffer);
    this.big64  = new BigUint64Array(this.buffer);

    // Generation counter at byte 0 of the alignment region after entries
    // ES: Contador de generación al final del buffer
    this.genOffset = this.bufferSize / 4 - 2; // in Int32 units
  }

  get generation() {
    return Atomics.load(this.int32, this.genOffset);
  }

  set generation(val) {
    Atomics.store(this.int32, this.genOffset, val);
  }

  incrementGeneration() {
    return Atomics.add(this.int32, this.genOffset, 1);
  }

  _slot(hash) {
    // Jenkins-style mixing for better distribution
    // ES: Mezcla estilo Jenkins para mejor distribución
    const h = Number(BigInt.asUintN(32, hash ^ (hash >> 32n)));
    return Math.abs((h * 2654435761) >>> 0) % this.maxEntries;
  }

  /**
   * Look up an entry in the shared TT.
   * Returns { depth, score, flag, bestMoveKey } or null if not found / stale.
   */
  get(hash) {
    const slot = this._slot(hash);
    const byteOff = slot * ENTRY_SIZE;
    const intOff  = byteOff / 4;

    // Read hash atomically (as two Int32 for atomicity)
    // Use Atomics.load for the key fields to ensure consistency
    const storedHashLo = Atomics.load(this.uint32, intOff);
    const storedHashHi = Atomics.load(this.uint32, intOff + 1);
    const storedHash = (BigInt(storedHashHi) << 32n) | BigInt(storedHashLo);

    if (storedHash !== hash) return undefined;

    const score = Atomics.load(this.int32, intOff + 2);  // byteOff+8
    const depth = this._readDepth(intOff + 3);             // byteOff+12 (Int16, no Atomics — DataView)
    const flags = Atomics.load(this.uint8, byteOff + FLAGS_OFF);
    const bestMoveKey = Atomics.load(this.uint32, intOff + 4); // byteOff+16

    return { depth, score, flag: flags, bestMoveKey };
  }

  /**
   * Store an entry in the shared TT.
   * Uses depth-preferred replacement (only overwrite if new depth >= stored depth).
   */
  set(hash, { depth, score, flag, bestMoveKey }) {
    const slot  = this._slot(hash);
    const byteOff = slot * ENTRY_SIZE;
    const intOff  = byteOff / 4;

    // Check existing depth first
    const existingDepth = this._readDepth(intOff + 3);
    if (existingDepth > depth) return; // depth-preferred: keep deeper entry

    // Write fields. Use Atomics.store for fields that matter.
    const hashLo = Number(BigInt.asUintN(32, hash));
    const hashHi = Number(BigInt.asUintN(32, hash >> 32n));
    Atomics.store(this.uint32, intOff,     hashLo);
    Atomics.store(this.uint32, intOff + 1, hashHi);
    Atomics.store(this.int32,  intOff + 2, score);
    this._writeDepth(intOff + 3, depth);
    Atomics.store(this.uint8,  byteOff + FLAGS_OFF, flag);
    Atomics.store(this.uint32, intOff + 4, bestMoveKey ?? 0);
  }

  _readDepth(int32Index) {
    const byteOff = int32Index * 4;
    const view = new DataView(this.buffer);
    try { return view.getInt16(byteOff, true); } catch { return 0; }
  }

  _writeDepth(int32Index, depth) {
    const byteOff = int32Index * 4;
    const view = new DataView(this.buffer);
    try { view.setInt16(byteOff, depth, true); } catch {}
  }

  // Helper: access buffer as Int16 at a given Int32 index
  int16At(int32Index) {
    // Each Int32 is 4 bytes; to get Int16 at offset, compute byte offset and use DataView
    const byteOff = int32Index * 4;
    const view = new DataView(this.buffer);
    return view.getInt16(byteOff, true); // little-endian
  }

  /**
   * Clear the entire table (by zeroing the generation counter and all entries).
   * Since entries are checked by hash match (not generation), we just need
   * to invalidate by writing zeros to the first 8 bytes of each entry.
   */
  clear() {
    // Invalidate all entries by writing 0n to the hash field
    const view = new BigUint64Array(this.buffer, 0, this.maxEntries);
    view.fill(0n);
    this.generation = 0;
  }

  get map() {
    // Compatibility shim for bot.js logging
    return {
      size: this.approximateSize(),
      _tt: this,
    };
  }

  approximateSize() {
    // Count non-zero entries (sampling for performance)
    // ES: Contar entradas no-cero (muestreo para rendimiento)
    let count = 0;
    const step = Math.max(1, Math.floor(this.maxEntries / 1000));
    const view = new BigUint64Array(this.buffer, 0, this.maxEntries);
    for (let i = 0; i < this.maxEntries; i += step) {
      if (view[i] !== 0n) count++;
    }
    return count * step;
  }
}

// ── Parallel root search orchestrator ──
// ES: Orquestador de búsqueda raíz paralela

/**
 * Split root moves among N workers for parallel search.
 * Each worker searches a subset of root moves at the given depth,
 * and the orchestrator merges results.
 */

export class ParallelRootSearch {
  /**
   * @param {Function} searchFn - Async function that takes a worker index and returns result
   * @param {number} numWorkers - Number of parallel workers (1 = sequential)
   */
  constructor(searchFn, numWorkers = 1) {
    this.searchFn   = searchFn;
    this.numWorkers = numWorkers;
  }

  /**
   * Split moves into chunks for each worker.
   * Returns array of { workerIndex, moves[] }
   */
  static splitMoves(moves, numWorkers) {
    const chunks = [];
    for (let i = 0; i < numWorkers; i++) chunks.push([]);
    for (let i = 0; i < moves.length; i++) {
      chunks[i % numWorkers].push(moves[i]);
    }
    return chunks;
  }
}

export { TT_EXACT, TT_ALPHA, TT_BETA };