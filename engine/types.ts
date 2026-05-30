// ═════════════════════════════════════════════════════
//  Core Type Definitions for Weigong Engine
// ES: Definiciones de tipos núcleo para el motor Weigong
// ═════════════════════════════════════════════════════

export type Side = 'white' | 'black';

export type PieceType = 'king' | 'queen' | 'general' | 'elephant' | 'priest' |
  'horse' | 'cannon' | 'tower' | 'carriage' | 'archer' | 'pawn' | 'crossbow';

export interface Piece {
  type: PieceType;
  side: Side;
  promoted: boolean;
  id?: string;
}

export interface Position {
  r: number;
  c: number;
}

export interface Move {
  from?: Position;
  to?: Position;
  fromReserve?: boolean;
  reserveIndex?: number;
  promotion?: boolean;
}

export interface MoveCandidate {
  r: number;
  c: number;
  capture: boolean;
  special?: string | null;
}

export interface NormalizedMove {
  from?: Position;
  to?: Position;
  fromReserve?: boolean;
  reserveIndex?: number;
  promotion: boolean;
  silent?: boolean;
}

export interface PalaceCurseData {
  white: { turnsInPalace?: number; active?: boolean };
  black: { turnsInPalace?: number; active?: boolean };
}

export interface GameState {
  board: Board;
  turn: Side;
  selected: Position | null;
  legalMoves: MoveCandidate[];
  reserves: {
    white: Piece[];
    black: Piece[];
  };
  promotionRequest: any;
  status: string;
  message: string;
  palaceTimers: {
    white: { turns?: number };
    black: { turns?: number };
  };
  palaceTaken: {
    white: boolean;
    black: boolean;
  };
  palaceCurse: PalaceCurseData | null;
  lastMove: {
    from: Position;
    to: Position;
    r?: number;
    c?: number;
  } | null;
  lastRepeatedMoveKey: number | null;
  repeatMoveCount: number;
  positionHistory: Map<string, number>;
  history: bigint[] | null;
  archerAmbush: any;
}

export type BoardRow = (Piece | null)[];
export type Board = BoardRow[];

export interface AttackMapWrapper {
  _arr: Uint8Array;
  _raw?: AttackMapRaw;
  _byPiece?: Uint8Array;
  _mobCount?: number;
  _kingIdx?: number;
  get(k: string): number;
  [Symbol.iterator](): Iterator<[string, number]>;
}

export interface AttackMapRaw {
  attack: Uint8Array;
  byPiece: Uint8Array;
  mobCount: number;
  kingIdx: number;
  enemyKingIdx: number;
}

export interface ByPieceWrapper {
  _arr: Uint8Array;
  get(k: string): number;
  [Symbol.iterator](): Iterator<[string, number]>;
}

export interface AttackMaps {
  attackMap: AttackMapWrapper;
  byPiece: ByPieceWrapper;
  mobilityCount: { total: number };
  kingPos: Position | null;
}

export interface AttackMapsPair {
  black: AttackMaps;
  white: AttackMaps;
  _blackInc?: IncrementalInstance;
  _whiteInc?: IncrementalInstance;
}

export interface IncrementalInstance {
  init(board: Board, side: Side): AttackMaps;
  get(): AttackMaps;
  applyMove(state: GameState, move: Move, capturedPiece: Piece | null, movedPiece: Piece | null, shouldPromote: boolean): void;
  unmakeMove(state: GameState): void;
  rebuild(board: Board): void;
}

export interface MoveData {
  action: NormalizedMove | null;
  undo: UndoState | null;
  hash: bigint;
  evalDiff: number;
  maps?: AttackMapsPair | null;
}

export interface UndoState {
  cells: ({ r: number; c: number; p: Piece | null } | null)[];
  cellCount: number;
  turn: Side | null;
  lastMove: any;
  reservesW: any;
  reservesB: any;
  reserveRemoved: { index: number; entry: Piece } | null;
  reserveCaptureAdded: boolean;
  palaceTaken: any;
  palaceTimers: any;
  palaceCurse: any;
  history: any;
  historyLength: number;
  positionHistory: any;
  lastRepeatedMoveKey: any;
  repeatMoveCount: number;
  archerAmbush: any;
  selected: any;
  legalMoves: any;
  promotionRequest: any;
  message: any;
  status: any;
  hash: any;
  eval: any;
}

export interface TTCacheEntry {
  depth: number;
  score: number;
  flag: number;
  bestMoveKey?: number;
}

export interface EvalMetrics {
  palacePressure: number;
  pieceActivity: number;
  materialBalance: number;
  kingSafety: number;
  centerControl: number;
  palaceDefense: number;
  riverControl: number;
}

export interface EvalResult {
  score: number;
  metrics: EvalMetrics;
}

export interface SearchResult {
  bestMove: NormalizedMove | null;
  score: number;
}

export interface BotOptions {
  maxDepth?: number;
  timeLimitMs?: number;
  aspirationWindow?: number;
  rootNNByMoveKey?: Map<number, number> | null;
  danceTracker?: any;
  _sharedTTBuffer?: ArrayBuffer | null;
}

// Piece ID encoding for typed array board
export const PIECE_KING    = 0;
export const PIECE_QUEEN   = 1;
export const PIECE_GENERAL = 2;
export const PIECE_ELEPHANT = 3;
export const PIECE_PRIEST  = 4;
export const PIECE_HORSE   = 5;
export const PIECE_CANNON  = 6;
export const PIECE_TOWER   = 7;
export const PIECE_CARRIAGE = 8;
export const PIECE_ARCHER  = 9;
export const PIECE_PAWN    = 10;
export const PIECE_CROSSBOW = 11;

export const PIECE_ENCODING: Record<PieceType, number> = {
  king: PIECE_KING, queen: PIECE_QUEEN, general: PIECE_GENERAL,
  elephant: PIECE_ELEPHANT, priest: PIECE_PRIEST, horse: PIECE_HORSE,
  cannon: PIECE_CANNON, tower: PIECE_TOWER, carriage: PIECE_CARRIAGE,
  archer: PIECE_ARCHER, pawn: PIECE_PAWN, crossbow: PIECE_CROSSBOW,
};

export const PIECE_DECODING: Record<number, PieceType> = {
  [PIECE_KING]: 'king', [PIECE_QUEEN]: 'queen', [PIECE_GENERAL]: 'general',
  [PIECE_ELEPHANT]: 'elephant', [PIECE_PRIEST]: 'priest', [PIECE_HORSE]: 'horse',
  [PIECE_CANNON]: 'cannon', [PIECE_TOWER]: 'tower', [PIECE_CARRIAGE]: 'carriage',
  [PIECE_ARCHER]: 'archer', [PIECE_PAWN]: 'pawn', [PIECE_CROSSBOW]: 'crossbow',
};

// Encode a piece into a single Uint16 value for typed array storage
// Bits: [side:1][type:4][promoted:1][padding:10]
export function encodePiece(piece: Piece | null): number {
  if (!piece) return 0;
  const sideBit = piece.side === 'black' ? 0x8000 : 0x4000;
  const typeBits = (PIECE_ENCODING[piece.type] & 0xF) << 8;
  const promoBit = piece.promoted ? 0x0100 : 0;
  return sideBit | typeBits | promoBit;
}

export function decodePiece(encoded: number): Piece | null {
  if (encoded === 0) return null;
  const side: Side = (encoded & 0x8000) ? 'black' : 'white';
  const typeEnc = (encoded >> 8) & 0xF;
  const type = PIECE_DECODING[typeEnc];
  if (!type) return null;
  const promoted = !!(encoded & 0x0100);
  return { type, side, promoted };
}