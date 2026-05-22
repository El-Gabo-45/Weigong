// ── FIX-10: Ruta corregida — era '../src/constants.js', que no existe en el codebase.
// ES: ruta corregida a '../constants.js' para consistencia con el resto del proyecto.
import { BOARD_SIZE, SIDE } from '../constants.js';
import { createGame } from '../rules/index.js';

// Minimal state copy for the bot (canonical version — same as server.js/selfplay.js)
// ES: Copia mínima del estado para el bot (versión canónica)
export function cloneStateForBot(state) {
  const board = new Array(BOARD_SIZE);
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = new Array(BOARD_SIZE);
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = state.board[r][c];
      board[r][c] = p ? { ...p } : null;
    }
  }
  return {
    board,
    turn: state.turn,
    selected: null,
    legalMoves: [],
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
    },
    promotionRequest: null,
    status: state.status,
    message: '',
    palaceTimers: {
      white: { ...state.palaceTimers?.white ?? { pressure: 0, invaded: false, attackerSide: null } },
      black: { ...state.palaceTimers?.black ?? { pressure: 0, invaded: false, attackerSide: null } },
    },
    palaceTaken:  { white: state.palaceTaken?.white ?? false, black: state.palaceTaken?.black ?? false },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount: state.repeatMoveCount ?? 0,
    positionHistory: state.positionHistory instanceof Map
      ? new Map(state.positionHistory) : new Map(),
    history: state.history ? [...state.history] : [],
    archerAmbush: null,
  };
}

// Game state
export const state = createGame();

// All mutable variables in a single object
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

  lastAnalyzedHash: null,
  analysisNNScore: null,
  analysisNNHash: null,
};

export function cancelBotTimer() {
  if (V.botTimeout) { clearTimeout(V.botTimeout); V.botTimeout = null; }
  V.botThinking = false;
  V.botToken += 1;
}

export function clearSelection() {
  state.selected = null;
  state.legalMoves = [];
  V.selectedReserve = null;
  V.pendingMove = null;
  V.pendingAmbush = null;
}

// ── FIX-9: Los console.log con document.getElementById se mueven dentro de una
// función init() para que state.js sea importable en Node.js sin crashear.
// Llama a initDOMRefs() desde tu punto de entrada del frontend después del DOMContentLoaded.
// ES: DOM refs movidas a función lazy — evita crash en Node donde document no existe.
export let boardEl, turnLabel, phaseLabel, reserveWhite, reserveBlack,
           resetBtn, botToggleBtn, promotionModal, promotionTitle, promotionText,
           promotionChoices, ambushModal, ambushTitle, ambushText, ambushChoices,
           difficultySelect, aiVsAiBtn, trainBtn, messageBar, rulesSummary,
           moveTimeline, loadGameBtn, loadGameInput;

export function initDOMRefs() {
  boardEl          = document.getElementById('board');
  turnLabel        = document.getElementById('turnLabel');
  phaseLabel       = document.getElementById('phaseLabel');
  reserveWhite     = document.getElementById('reserveWhite');
  reserveBlack     = document.getElementById('reserveBlack');
  resetBtn         = document.getElementById('resetBtn');
  botToggleBtn     = document.getElementById('botToggleBtn');
  promotionModal   = document.getElementById('promotionModal');
  promotionTitle   = document.getElementById('promotionTitle');
  promotionText    = document.getElementById('promotionText');
  promotionChoices = document.getElementById('promotionChoices');
  ambushModal      = document.getElementById('ambushModal');
  ambushTitle      = document.getElementById('ambushTitle');
  ambushText       = document.getElementById('ambushText');
  ambushChoices    = document.getElementById('ambushChoices');
  difficultySelect = document.getElementById('difficultySelect');
  aiVsAiBtn        = document.getElementById('aiVsAiBtn');
  trainBtn         = document.getElementById('trainBtn');
  messageBar       = document.getElementById('messageBar');
  rulesSummary     = document.getElementById('rulesSummary');
  moveTimeline     = document.getElementById('moveTimeline');
  loadGameBtn      = document.getElementById('loadGameBtn');
  loadGameInput    = document.getElementById('loadGameInput');
}

export const COLS = 'ABCDEFGHIJKLM';