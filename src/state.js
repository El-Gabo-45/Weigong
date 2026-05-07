import { BOARD_SIZE, SIDE } from "./constants.js";
import { createGame } from "./rules/index.js";

// ── Copia mínima del estado para el bot ──
export function cloneStateForBot(state) {
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
      white: { ...state.palaceTimers?.white },
      black: { ...state.palaceTimers?.black },
    },
    palaceTaken:  { ...state.palaceTaken  },
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
  };
}

// ────────── Estado de la partida ──────────
export const state = createGame();

// ─── Todas las variables mutables en un solo objeto ───
export const V = {
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
};

// ── Utilidades simples que solo modifican V/ simple utilities, it just modify V/ ──
export function cancelBotTimer() { if (V.botTimeout) { clearTimeout(V.botTimeout); V.botTimeout = null; } V.botThinking = false; V.botToken += 1; }
export function clearSelection() { state.selected = null; state.legalMoves = []; V.selectedReserve = null; V.pendingMove = null; V.pendingAmbush = null; }

console.log("BOARD_SIZE:", BOARD_SIZE);
console.log("boardEl:", document.getElementById("board"));

// Elementos del DOM
export const boardEl          = document.getElementById("board");
export const turnLabel        = document.getElementById("turnLabel");
export const phaseLabel       = document.getElementById("phaseLabel");
export const reserveWhite     = document.getElementById("reserveWhite");
export const reserveBlack     = document.getElementById("reserveBlack");
export const resetBtn         = document.getElementById("resetBtn");
export const botToggleBtn     = document.getElementById("botToggleBtn");
export const promotionModal   = document.getElementById("promotionModal");
export const promotionTitle   = document.getElementById("promotionTitle");
export const promotionText    = document.getElementById("promotionText");
export const promotionChoices = document.getElementById("promotionChoices");
export const ambushModal      = document.getElementById("ambushModal");
export const ambushTitle      = document.getElementById("ambushTitle");
export const ambushText       = document.getElementById("ambushText");
export const ambushChoices    = document.getElementById("ambushChoices");
export const difficultySelect = document.getElementById("difficultySelect");
export const aiVsAiBtn        = document.getElementById("aiVsAiBtn");
export const trainBtn         = document.getElementById("trainBtn");
export const messageBar       = document.getElementById("messageBar");
export const rulesSummary     = document.getElementById("rulesSummary");
export const moveTimeline     = document.getElementById("moveTimeline");
export const loadGameBtn      = document.getElementById("loadGameBtn");
export const loadGameInput    = document.getElementById("loadGameInput");

export const COLS = "ABCDEFGHIJKLM";