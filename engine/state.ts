// ═════════════════════════════════════════════════════
//  Game State & DOM References (EN/ES)
// ES: Game State & DOM References (EN/ES)
// ═════════════════════════════════════════════════════

import { BOARD_SIZE, SIDE } from "./constants.js";
import { createGame } from "./rules/index.js";
import type { GameState } from "./types.js";
import type { Side } from "./types.js";

// Minimal state copy for the bot
// ES: Copia mínima del estado para el bot
export function cloneStateForBot(state: GameState): GameState {
  const board = new Array(BOARD_SIZE);
  for (let r = 0; r < BOARD_SIZE; r++) board[r] = state.board[r].map(p => p ? { ...p } : null);
  return {
    board,
    turn: state.turn,
    selected: null,
    legalMoves: [],
    reserves: {
      white: state.reserves.white.map(p => ({ ...p })),
      black: state.reserves.black.map(p => ({ ...p })),
    },
    promotionRequest: null,
    status: state.status,
    message: '',
    palaceTimers: {
      white: { ...(state.palaceTimers?.white ?? {}) },
      black: { ...(state.palaceTimers?.black ?? {}) },
    },
    palaceTaken:  { ...(state.palaceTaken ?? { white: false, black: false }) },
    palaceCurse: state.palaceCurse ? {
      white: { ...state.palaceCurse.white },
      black: { ...state.palaceCurse.black },
    } : null,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount: state.repeatMoveCount ?? 0,
    positionHistory: state.positionHistory instanceof Map
      ? new Map(state.positionHistory) : new Map(),
    history: state.history ? [...state.history] : [],
    archerAmbush: null,
    moveCount: (state as any).moveCount ?? 0,
  };
}

// Game state
// ES: Estado de la partida
export const state: GameState = createGame();

// All mutable variables in a single object
// ES: Todas las variables mutables en un solo objeto
export interface VType {
  totalMoves: number;
  currentGameNotation: any[];
  gameMovesData: any[];
  humanGameFinalized: boolean;
  aiVsAiMode: boolean;
  aiVsAiRunning: boolean;
  aiVsAiMoves: any[];
  trainingMode: boolean;
  trainingCount: number;
  trainingRunning: boolean;
  selectedReserve: any;
  pendingMove: any;
  pendingAmbush: any;
  botEnabled: boolean;
  botThinking: boolean;
  botTimeout: any;
  botToken: number;
  timelineSnapshots: any[];
  viewPly: number;
  editorActive: boolean;
  analysisMode: boolean;
  analysisPositionHash: any;
  analysisResult: any;
  analysisRunning: boolean;
}

export const V: VType = {
  totalMoves: 0,
  currentGameNotation: [],
  gameMovesData: [],
  humanGameFinalized: false,

  aiVsAiMode: false,
  aiVsAiRunning: false,
  aiVsAiMoves: [],

  trainingMode: false,
  trainingCount: 0,
  trainingRunning: false,

  selectedReserve: null,
  pendingMove: null,
  pendingAmbush: null,
  botEnabled: false,
  botThinking: false,
  botTimeout: null,
  botToken: 0,

  timelineSnapshots: [],
  viewPly: 0,

  editorActive: false,
  analysisMode: false,
  analysisPositionHash: null,
  analysisResult: null,
  analysisRunning: false,
};

// Simple utilities that only modify V
// ES: Utilidades simples que solo modifican V
export function cancelBotTimer(): void { if (V.botTimeout) { clearTimeout(V.botTimeout); V.botTimeout = null; } V.botThinking = false; V.botToken += 1; }
export function clearSelection(): void { state.selected = null; state.legalMoves = []; V.selectedReserve = null; V.pendingMove = null; V.pendingAmbush = null; }

export {
  boardEl, turnLabel, phaseLabel,
  reserveWhite, reserveBlack,
  resetBtn, botToggleBtn, analysisModeBtn,
  analysisPanel, analysisInfo,
  analysisBarFill, analysisBarFiller, analysisBarLabel,
  promotionModal, promotionTitle, promotionText, promotionChoices,
  ambushModal, ambushTitle, ambushText, ambushChoices,
  difficultySelect, aiVsAiBtn, trainBtn,
  messageBar, rulesSummary, moveTimeline,
  loadGameBtn, loadGameInput,
  COLS,
} from '../src/ui/dom-references.js';
