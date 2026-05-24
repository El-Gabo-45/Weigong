// ── Packed Board Representation ──
// ES: Representación compacta del tablero
//
// Encodes the full board + reserves + turn + palace state into compact Uint8/Int32 arrays.
// This reduces memory by ~10x vs object-based state, speeds up cloning, and allows
// efficient storage in the shared TT and worker message passing.
//
// Board cell encoding (1 byte per cell, 169 bytes total):
//   bits 0-3: piece type index (0=empty, 1-12=king,queen,...,crossbow)
//   bit 4:    side (0=white, 1=black)
//   bit 5:    promoted
//   bit 6:    locked
//   bit 7:    unused
//
// Reserves encoding: 2 × (12 types × 1 byte count) = 24 bytes
// Turn + status: 2 bytes
// Palace state: 4 bytes
// Total ~200 bytes per packed state

const BOARD_SIZE = 13;
const NUM_CELLS  = BOARD_SIZE * BOARD_SIZE; // 169

// Piece type → index (1-based, 0 = empty)
const TYPE_TO_IDX = {
  king:1, queen:2, general:3, elephant:4, priest:5,
  horse:6, cannon:7, tower:8, carriage:9, archer:10,
  pawn:11, crossbow:12,
};
const IDX_TO_TYPE = [
  null, 'king','queen','general','elephant','priest',
  'horse','cannon','tower','carriage','archer',
  'pawn','crossbow',
];

const RESERVE_TYPES = ['tower','general','pawn','crossbow'];

// ── PackedBoard class ──
// ES: Tablero empaquetado

export class PackedBoard {
  /**
   * @param {Uint8Array} [board] - If provided, use as backing store (169 bytes)
   * @param {Uint8Array} [reserves] - If provided, use as backing store (24 bytes)
   * @param {Uint8Array} [meta] - If provided, use as backing store (8 bytes: turn,status,palace)
   */
  constructor(board = null, reserves = null, meta = null) {
    this.board   = board   ?? new Uint8Array(NUM_CELLS);
    this.reserves = reserves ?? new Uint8Array(24); // 2 sides × 4 reserve types × 1 byte count
    this.meta    = meta    ?? new Uint8Array(8);
  }

  /** Total bytes of packed representation */
  get byteLength() { return NUM_CELLS + 24 + 8; }

  /**
   * Create a full packed state as a single Uint8Array suitable for
   * SharedArrayBuffer or structured clone transfer.
   * ES: Estado completo empaquetado en un solo Uint8Array.
   */
  toFlat() {
    const flat = new Uint8Array(this.byteLength);
    flat.set(this.board, 0);
    flat.set(this.reserves, NUM_CELLS);
    flat.set(this.meta, NUM_CELLS + 24);
    return flat;
  }

  /**
   * Load from a flat Uint8Array produced by toFlat().
   */
  fromFlat(flat) {
    this.board.set(flat.subarray(0, NUM_CELLS), 0);
    this.reserves.set(flat.subarray(NUM_CELLS, NUM_CELLS + 24), 0);
    this.meta.set(flat.subarray(NUM_CELLS + 24, NUM_CELLS + 24 + 8), 0);
    return this;
  }

  // ── Getters / Setters ──

  get turn() { return this.meta[0]; }
  set turn(v) { this.meta[0] = v; }

  get status() { return this.meta[1]; }
  set status(v) { this.meta[1] = v; }

  get palaceWhite() { return this.meta[2]; }
  set palaceWhite(v) { this.meta[2] = v ? 1 : 0; }

  get palaceBlack() { return this.meta[3]; }
  set palaceBlack(v) { this.meta[3] = v ? 1 : 0; }

  // Packed misc flags: bits 0=palaceWhite,1=palaceBlack,2-7=unused
  get palaceTakenByte() { return this.meta[4]; }
  set palaceTakenByte(v) { this.meta[4] = v; }

  /**
   * Get cell encoding at position (r,c).
   * Returns 0 if empty.
   */
  getCell(r, c) {
    return this.board[r * BOARD_SIZE + c];
  }

  /**
   * Set cell at position (r,c).
   * @param {number} r
   * @param {number} c
   * @param {object|null} piece - Piece object { type, side, promoted, locked } or null
   */
  setCell(r, c, piece) {
    const idx = r * BOARD_SIZE + c;
    if (!piece) {
      this.board[idx] = 0;
      return;
    }
    const typeIdx = TYPE_TO_IDX[piece.type];
    if (typeIdx === undefined) { this.board[idx] = 0; return; }
    let enc = typeIdx & 0x0F;
    if (piece.side === 'black' || piece.side === 1) enc |= 0x10;
    if (piece.promoted) enc |= 0x20;
    if (piece.locked)   enc |= 0x40;
    this.board[idx] = enc;
  }

  /**
   * Decode a cell into a piece object (or null).
   */
  decodeCell(r, c) {
    const enc = this.board[r * BOARD_SIZE + c];
    if (enc === 0) return null;
    const typeIdx  = enc & 0x0F;
    const side     = (enc & 0x10) ? 'black' : 'white';
    const promoted = !!(enc & 0x20);
    const locked   = !!(enc & 0x40);
    const type     = IDX_TO_TYPE[typeIdx];
    if (!type) return null;
    return { type, side, promoted, locked };
  }

  /**
   * Decode the full board into a 13×13 array of objects.
   */
  decodeBoard() {
    const result = new Array(BOARD_SIZE);
    for (let r = 0; r < BOARD_SIZE; r++) {
      result[r] = new Array(BOARD_SIZE);
      for (let c = 0; c < BOARD_SIZE; c++) {
        result[r][c] = this.decodeCell(r, c);
      }
    }
    return result;
  }

  // ── Reserve encoding ──
  // reserves[0..3]   = white reserves (tower,general,pawn,crossbow)
  // reserves[4..7]   = unused (could extend)
  // reserves[8..11]  = black reserves (tower,general,pawn,crossbow)
  // reserves[12..23] = unused

  getReserveCount(side, type) {
    const offset = side === 'white' || side === 0 ? 0 : 8;
    const typeIdx = RESERVE_TYPES.indexOf(type);
    if (typeIdx < 0) return 0;
    return this.reserves[offset + typeIdx];
  }

  setReserveCount(side, type, count) {
    const offset = side === 'white' || side === 0 ? 0 : 8;
    const typeIdx = RESERVE_TYPES.indexOf(type);
    if (typeIdx < 0) return;
    this.reserves[offset + typeIdx] = Math.max(0, Math.min(255, count));
  }

  /**
   * Encode reserves from state object into packed format.
   */
  encodeReservesFromState(state) {
    // Clear both sides
    for (let i = 0; i < 24; i++) this.reserves[i] = 0;
    // Count white
    for (const p of state.reserves.white) {
      const idx = RESERVE_TYPES.indexOf(p.type);
      if (idx >= 0) this.reserves[idx]++;
    }
    // Count black
    for (const p of state.reserves.black) {
      const idx = RESERVE_TYPES.indexOf(p.type);
      if (idx >= 0) this.reserves[8 + idx]++;
    }
  }

  /**
   * Encode the entire state into packed format.
   * @param {object} state - Game state object
   * @returns {PackedBoard} this
   */
  encodeState(state) {
    // Board cells
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        this.setCell(r, c, state.board[r][c]);
      }
    }
    // Reserves
    this.encodeReservesFromState(state);
    // Meta
    this.turn = state.turn === 'black' || state.turn === 1 ? 1 : 0;
    this.status = statusToByte(state.status);
    this.palaceWhite = state.palaceTaken?.white ? 1 : 0;
    this.palaceBlack = state.palaceTaken?.black ? 1 : 0;
    this.palaceTakenByte = (state.palaceTaken?.white ? 1 : 0) | (state.palaceTaken?.black ? 2 : 0);
    return this;
  }

  /**
   * Pack a state into a single flat Uint8Array (convenience).
   */
  static pack(state) {
    return new PackedBoard().encodeState(state).toFlat();
  }

  /**
   * Create a minimal state object (board array + turn + reserves + palace) from packed data.
   * This is enough for the search engine to work with (doesn't include history, etc.)
   */
  toLightState() {
    const board = new Array(BOARD_SIZE);
    for (let r = 0; r < BOARD_SIZE; r++) {
      board[r] = new Array(BOARD_SIZE);
      for (let c = 0; c < BOARD_SIZE; c++) {
        board[r][c] = this.decodeCell(r, c);
      }
    }
    // Reconstruct reserves
    const reserves = { white: [], black: [] };
    for (const side of ['white','black']) {
      const offset = side === 'white' ? 0 : 8;
      for (let ti = 0; ti < RESERVE_TYPES.length; ti++) {
        const count = this.reserves[offset + ti];
        const type = RESERVE_TYPES[ti];
        for (let i = 0; i < count; i++) {
          reserves[side].push({ type, side, promoted: type === 'crossbow', locked: false, id: 0 });
        }
      }
    }
    return {
      board,
      turn: this.turn === 1 ? 'black' : 'white',
      reserves,
      selected: null, legalMoves: [], promotionRequest: null,
      palaceTaken: {
        white: !!(this.palaceTakenByte & 1),
        black: !!(this.palaceTakenByte & 2),
      },
      palaceTimers: {
        white: { invaded: false, pressure: 0, attackerSide: null },
        black: { invaded: false, pressure: 0, attackerSide: null },
      },
      palaceCurse: {
        white: { active: false, turnsInPalace: 0 },
        black: { active: false, turnsInPalace: 0 },
      },
      lastMove: null,
      lastRepeatedMoveKey: null,
      repeatMoveCount: 0,
      history: [],
      positionHistory: new Map(),
      status: byteToStatus(this.status),
      message: '',
      archerAmbush: null,
    };
  }
}

// ── Status encoding ──
const STATUS_MAP = {
  'playing': 0,
  'checkmate': 1,
  'stalemate': 2,
  'draw': 3,
  'draw_move_limit': 4,
  'draw_agreement': 5,
  'palacemate': 6,
};
const STATUS_REVERSE = {};
for (const [k, v] of Object.entries(STATUS_MAP)) STATUS_REVERSE[v] = k;

function statusToByte(s) { return STATUS_MAP[s] ?? 0; }
function byteToStatus(b) { return STATUS_REVERSE[b] ?? 'playing'; }

// ── Fast state clone using packed intermediate ──
// ES: Clonación rápida usando representación empaquetada intermedia

/**
 * Clone a game state using packed representation as intermediate.
 * Much faster than manual deep-clone of 169 cells + reserves + metadata.
 * ES: Clonar estado usando representación empaquetada como intermediario.
 * Mucho más rápido que clonar manualmente 169 celdas + reservas + metadatos.
 */
export function fastCloneState(state) {
  const packed = new PackedBoard().encodeState(state);
  const light = packed.toLightState();
  // Carry over fields that packed doesn't encode:
  light.lastMove = state.lastMove ? {
    from: state.lastMove.from ? { ...state.lastMove.from } : null,
    to: state.lastMove.to ? { ...state.lastMove.to } : null,
    ...(state.lastMove.fromReserve ? { fromReserve: true, reserveIndex: state.lastMove.reserveIndex } : {}),
    promotion: state.lastMove.promotion ?? false,
  } : null;
  light.history = state.history ? [...state.history] : [];
  light.lastRepeatedMoveKey = state.lastRepeatedMoveKey ?? null;
  light.repeatMoveCount = state.repeatMoveCount ?? 0;
  light.message = state.message ?? '';
  light.archerAmbush = null;
  light.selected = null;
  light.legalMoves = [];
  light.promotionRequest = null;
  return light;
}

// ── Exports ──
export { RESERVE_TYPES, TYPE_TO_IDX, IDX_TO_TYPE };