// ── FIX-10: Ruta corregida — era '../src/constants.js', que no existe en el codebase.
// ES: ruta corregida a '../constants.js' para consistencia con el resto del proyecto.
import { BOARD_SIZE, SIDE } from '../constants.js';
import { createGame } from '../rules/index.js';
import { fastCloneState } from '../ai/packed-state.js';

// Minimal state copy for the bot (canonical version — same as server.js/selfplay.js)
// ES: Copia mínima del estado para el bot (versión canónica, optimizada con packed-state)
export function cloneStateForBot(state) {
  return fastCloneState(state);
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