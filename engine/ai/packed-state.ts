// Packed State - TypeScript
import { BOARD_SIZE } from '../constants.js';
import type { Board, GameState, Side, Piece } from '../types.js';

const NUM_BOARD_CELLS = BOARD_SIZE * BOARD_SIZE; // 169

/**
 * Compact board representation using Uint8Array.
 * Each cell stores: side_bit << 7 | type << 3 | promoted_bit << 2 | reserved
 * ES: Representación compacta del tablero usando Uint8Array.
 */
export class PackedBoard {
  data: Uint8Array;

  constructor() {
    this.data = new Uint8Array(NUM_BOARD_CELLS);
  }

  static _packPiece(p: Piece | null): number {
    if (!p) return 0;
    const sideBit = p.side === 'black' ? 0x80 : 0x40;
    const typeBits = (_typeToIndex(p.type) & 0xF) << 2;
    const promoBit = p.promoted ? 0x02 : 0;
    return sideBit | typeBits | promoBit;
  }

  static _unpackPiece(v: number): Piece | null {
    if (v === 0) return null;
    const side: Side = (v & 0x80) ? 'black' : 'white';
    const type = _indexToType((v >> 2) & 0xF);
    if (!type) return null;
    return { type: type as any, side, promoted: !!(v & 0x02) };
  }

  pack(board: Board): void {
    const d = this.data;
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = board[r];
      for (let c = 0; c < BOARD_SIZE; c++) {
        d[r * BOARD_SIZE + c] = PackedBoard._packPiece(row[c]);
      }
    }
  }

  unpack(board: Board): void {
    const d = this.data;
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = board[r];
      for (let c = 0; c < BOARD_SIZE; c++) {
        row[c] = PackedBoard._unpackPiece(d[r * BOARD_SIZE + c]);
      }
    }
  }

  toLightState(): GameState {
    // Creates a minimal state with just board, turn, and empty reserves
    const board: Board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      board[r] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        board[r][c] = PackedBoard._unpackPiece(this.data[r * BOARD_SIZE + c]);
      }
    }
    return {
      board,
      turn: 'black',
      selected: null,
      legalMoves: [],
      reserves: { white: [], black: [] },
      promotionRequest: null,
      status: 'playing',
      message: '',
      palaceTimers: { white: {}, black: {} },
      palaceTaken: { white: false, black: false },
      palaceCurse: null,
      lastMove: null,
      lastRepeatedMoveKey: null,
      repeatMoveCount: 0,
      positionHistory: new Map(),
      history: null,
      archerAmbush: null,
    };
  }

  fromFlat(src: Uint8Array): void {
    this.data.set(src);
  }

  toFlat(): Uint8Array {
    return new Uint8Array(this.data);
  }

  static pack(state: GameState): Uint8Array {
    const pb = new PackedBoard();
    pb.pack(state.board);
    return pb.data;
  }
}

function _typeToIndex(type: string): number {
  const map: Record<string, number> = {
    king: 0, queen: 1, general: 2, elephant: 3, priest: 4,
    horse: 5, cannon: 6, tower: 7, carriage: 8, archer: 9,
    pawn: 10, crossbow: 11,
  };
  return map[type] ?? 0;
}

const typeIndexMap: Record<number, string> = {
  0: 'king', 1: 'queen', 2: 'general', 3: 'elephant', 4: 'priest',
  5: 'horse', 6: 'cannon', 7: 'tower', 8: 'carriage', 9: 'archer',
  10: 'pawn', 11: 'crossbow',
};

function _indexToType(idx: number): string | undefined {
  return typeIndexMap[idx];
}

export function fastCloneState(state: GameState): GameState {
  const newBoard: Board = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    newBoard[r] = [];
    const row = state.board[r];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = row[c];
      newBoard[r][c] = p ? { ...p } : null;
    }
  }
  return {
    board: newBoard,
    turn: state.turn,
    selected: state.selected,
    legalMoves: state.legalMoves ?? [],
    reserves: {
      white: state.reserves.white.map((p: Piece) => ({ ...p })),
      black: state.reserves.black.map((p: Piece) => ({ ...p })),
    },
    promotionRequest: state.promotionRequest,
    status: state.status,
    message: state.message,
    palaceTimers: {
      white: { ...state.palaceTimers?.white },
      black: { ...state.palaceTimers?.black },
    },
    palaceTaken: { ...state.palaceTaken },
    palaceCurse: state.palaceCurse ? {
      white: { ...state.palaceCurse.white },
      black: { ...state.palaceCurse.black },
    } : null,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount: state.repeatMoveCount ?? 0,
    positionHistory: state.positionHistory instanceof Map
      ? new Map(state.positionHistory) : new Map(),
    history: state.history ? [...state.history] : null,
    archerAmbush: null,
  };
}