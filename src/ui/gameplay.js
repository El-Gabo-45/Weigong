import {
  SIDE, BOARD_SIZE, pieceLabel, pieceDisplayType, isPalaceSquare, isRiverSquare,
  homePromotionZone, opponent, isPromotableType, isReserveType, RESERVED_DROP_TYPES, onBank,
  PIECE_DATA
} from "../../engine/constants.js";
import {
  createGame, resetGame, getPieceMoves, getAllLegalMoves, getReserveEntries,
  applyMove, executeDrop, isPromotionAvailableForMove, afterMoveEvaluation,
  getBoardMeta, getPieceText, executeArcherAmbush, isKingInCheck,
  isPalaceCursedFor, getPalaceInvaders, getLegalReserveDrops,
} from "../../engine/rules/index.js";
import {
  chooseBlackBotMove, adaptiveMemory, loadAdaptiveMemory,
  evaluate, computeFullHash, extractFeatures, moveKey,
  gamePhaseFactor, queueAdaptiveMemorySave,
} from "../../engine/ai/index.js";
import {
  state, V,
  cloneStateForBot,
  cancelBotTimer, clearSelection,
  boardEl, turnLabel, phaseLabel, reserveWhite, reserveBlack,
  resetBtn, botToggleBtn, promotionModal, promotionTitle, promotionText, promotionChoices,
  ambushModal, ambushTitle, ambushText, ambushChoices,
  difficultySelect, aiVsAiBtn, trainBtn, messageBar, rulesSummary, moveTimeline,
  loadGameBtn, loadGameInput, COLS,
} from "../../engine/state.js";
import {
  recordTimelineSnapshot, renderTimeline, goToPly, markLastNotationForCurrentState,
  snapshotForTimeline,
} from "./timeline.js";
import { getPieceStyle, getSVGForPiece } from "./piece-style-selector.js";
import pako from 'pako';

function getPieceSymbol(type) {
  const symbols = { king:'K', queen:'Q', general:'G', elephant:'E', priest:'P', horse:'H', cannon:'C', tower:'T', carriage:'Ca', archer:'A', pawn:'p', crossbow:'B' };
  return symbols[type] || '?';
}

function generateMoveNotation(state, move, ambushInfo = null, chosenAmbushIndex = 0, capturedPiece = null) {
  if (!move) return '?';
  const toStr = `${COLS[move.to?.c ?? 0]}${13 - (move.to?.r ?? 0)}`;
  if (move.fromReserve) {
    const entry = state.reserves[state.turn]?.[move.reserveIndex];
    return `${getPieceSymbol(entry?.type ?? '?')}*${toStr}`;
  }
  if (!move.from) return '?';
  const piece = state.board[move.to.r]?.[move.to.c] ?? state.board[move.from.r]?.[move.from.c];
  if (!piece) return '?';
  const PROMO_SYMBOLS = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  const sym = piece.promoted ? (PROMO_SYMBOLS[piece.type] ?? getPieceSymbol(piece.type)) : getPieceSymbol(piece.type);
  if (piece.type === 'archer' && ambushInfo) {
    let nota = `A${toStr}`;
    if (ambushInfo.type === 'singleCapture') {
      const v = ambushInfo.victim;
      const vPiece = ambushInfo.victimPiece;
      const vSym = vPiece ? (vPiece.promoted ? (PROMO_SYMBOLS[vPiece.type] ?? getPieceSymbol(vPiece.type)) : getPieceSymbol(vPiece.type)) : '?';
      nota += `>${vSym}x${COLS[v.c]}${13 - v.r}`;
    } else if (ambushInfo.type === 'autoCaptureAll') {
      const parts = (ambushInfo.victimPieces ?? []).map((vp, i) => {
        const pos = ambushInfo.victims[i];
        const vsym = vp.promoted ? (PROMO_SYMBOLS[vp.type] ?? getPieceSymbol(vp.type)) : getPieceSymbol(vp.type);
        return `${vsym}x${COLS[pos.c]}${13 - pos.r}`;
      });
      if (parts.length) nota += `>${parts.join(',')}`;
    } else if (ambushInfo.type === 'chooseCapture') {
      const opts = ambushInfo.options;
      if (opts && opts.length > 0) {
        const chosen = opts[chosenAmbushIndex];
        const cSym = chosen.piece.promoted ? (PROMO_SYMBOLS[chosen.piece.type] ?? getPieceSymbol(chosen.piece.type)) : getPieceSymbol(chosen.piece.type);
        nota += `>${cSym}x${COLS[chosen.c]}${13 - chosen.r}`;
        for (let i = 0; i < opts.length; i++) {
          if (i === chosenAmbushIndex) continue;
          const opt = opts[i];
          const oSym = opt.piece.promoted ? (PROMO_SYMBOLS[opt.piece.type] ?? getPieceSymbol(opt.piece.type)) : getPieceSymbol(opt.piece.type);
          if (opt.canRetreat) {
            const retreatDir = piece.side === SIDE.BLACK ? 1 : -1;
            const rr = opt.r + retreatDir;
            nota += `,${oSym}${COLS[opt.c]}${13 - opt.r}→${COLS[opt.c]}${13 - rr}`;
          } else {
            nota += `,${oSym}x${COLS[opt.c]}${13 - opt.r}`;
          }
        }
      }
    }
    return nota;
  }
  const target = capturedPiece || state.board[move.to.r]?.[move.to.c];
  let notation = sym;
  if (target && target.side !== piece.side) {
    const targetSym = target.promoted ? (PROMO_SYMBOLS[target.type] ?? getPieceSymbol(target.type)) : getPieceSymbol(target.type);
    notation += `x${targetSym.toLowerCase()}${toStr}`;
  } else {
    notation += toStr;
  }
  if (move.promotion) notation += '+';
  return notation;
}

function appendCurseNotation(state) {
  const PROMO_SYMBOLS = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  let suffix = '';
  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const curse = state.palaceCurse?.[side];
    if (curse?.justActivated && curse.curseActivators) {
      const parts = [];
      for (const act of curse.curseActivators) {
        const sym = act.promoted ? (PROMO_SYMBOLS[act.type] ?? getPieceSymbol(act.type)) : getPieceSymbol(act.type);
        const loc = `${COLS[act.c]}${13 - act.r}`;
        parts.push(`${sym}${loc}`);
      }
      if (parts.length > 0) suffix += '&' + parts.join('&') + '-';
    }
  }
  return suffix || '';
}

function getPieceValue(piece) {
  const base  = { king:0, queen:950, general:560, elephant:240, priest:400, horse:320, cannon:450, tower:520, carriage:390, archer:450, pawn:110, crossbow:240 };
  const promo = { pawn:240, tower:650, horse:430, elephant:320, priest:540, cannon:540 };
  if (!piece) return 0;
  if (piece.promoted) return promo[piece.type] ?? (base[piece.type] ?? 0) + 120;
  return base[piece.type] ?? 0;
}

const PIECE_CHANNEL = { king:0, queen:1, general:2, elephant:3, priest:4, horse:5, cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11 };
const NN_CHANNELS = 24;
const NN_SIZE = BOARD_SIZE * BOARD_SIZE * NN_CHANNELS;

function encodeBoardForNN(board) {
  const enc = new Float32Array(NN_SIZE);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (!p) continue;
      const ch = PIECE_CHANNEL[p.type];
      if (ch === undefined) continue;
      const offset = p.side === SIDE.WHITE ? 0 : 12;
      enc[(r * BOARD_SIZE + c) * NN_CHANNELS + offset + ch] = 1.0;
    }
  }
  return enc;
}

function boardSnapshot(board) {
  const snap = new Array(BOARD_SIZE * BOARD_SIZE);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      snap[r * BOARD_SIZE + c] = p ? { t: p.type[0] + p.side[0], promoted: p.promoted ? 1 : 0 } : null;
    }
  }
  return snap;
}

function serializeState(state) {
  return {
    board: state.board.map(row => row.map(p => p ? { type: p.type, side: p.side, promoted: p.promoted } : null)),
    turn: state.turn,
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
    },
    palaceTaken: { white: state.palaceTaken.white, black: state.palaceTaken.black },
    palaceTimers: { white: { ...state.palaceTimers.white }, black: { ...state.palaceTimers.black } },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    history: state.history ? [...state.history] : [],
    positionHistory: [...(state.positionHistory?.entries() ?? [])],
    status: state.status,
  };
}

function buildMoveData(side, move, notation, evalBefore, evalResult, stateAfter) {
  const { score: evalAfter, metrics } = evalResult;
  const featureKey = extractFeatures(stateAfter, side);
  const positionHash = computeFullHash(stateAfter).toString();
  const nnEncoding = encodeBoardForNN(stateAfter.board);
  const snap = boardSnapshot(stateAfter.board);
  const stateAfterSerial = serializeState(stateAfter);
  return {
    side,
    moveKeyStr: moveKey(move, move.promotion ?? false),
    featureKey,
    evalBefore,
    evalAfter,
    notation: notation ?? '',
    metrics,
    positionHash,
    _nnFloat32: nnEncoding,
    boardSnapshot: snap,
    stateAfter: stateAfterSerial,
  };
}

async function sendGameForLearning(movesArray, finalStatus, result) {
  if (!movesArray || movesArray.length === 0) return;
  const gameData = {
    id: Date.now(), timestamp: new Date().toISOString(), finalStatus, result, totalMoves: movesArray.length,
    moves: movesArray.map((m, i) => ({
      turn: i + 1, side: m.side === SIDE.BLACK ? 'black' : 'white',
      moveKeyStr: m.moveKeyStr ?? null, featureKey: m.featureKey ?? null,
      evalBefore: m.evalBefore ?? null, evalAfter: m.evalAfter ?? null,
      metrics: m.metrics ?? null, notation: m.notation ?? '',
      positionHash: m.positionHash ?? null,
      _nnFloat32: m._nnFloat32 ? Array.from(m._nnFloat32) : undefined,
      boardSnapshot: m.boardSnapshot ?? undefined,
      stateAfter: m.stateAfter ?? undefined,
    })),
  };
  try {
    const compressed = pako.gzip(JSON.stringify(gameData));
    await fetch('/api/saveGame', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: compressed });
    await fetch('/api/learnFromGames', { method: 'POST' });
  } catch (e) { console.error('Error guardando/aprendiendo:', e); }
}

function sideName(side) { return side === SIDE.WHITE ? "White" : "Black"; }
function isVisuallyPromoted(p) { return p.promoted || p.type === "crossbow"; }
function updateBotButton() {
  if (!botToggleBtn) return;
  botToggleBtn.textContent = V.botEnabled ? "Black Bot: enabled" : "Black Bot: disabled";
  botToggleBtn.classList.toggle("active", V.botEnabled);
}
function scheduleBotMove() {
  if (!V.botEnabled || V.botThinking || state.status !== "playing" || state.turn !== SIDE.BLACK) return;
  if (V.botTimeout) return;
  V.botThinking = true; const token = ++V.botToken;
  V.botTimeout = setTimeout(() => {
    V.botTimeout = null;
    if (token !== V.botToken) { V.botThinking = false; return; }
    if (state.turn !== SIDE.BLACK || !V.botEnabled) { V.botThinking = false; return; }
    runBotTurn();
  }, 120);
}
function getBotParams() {
  const level = parseInt(difficultySelect?.value) || 5;
  const params = [
    { maxDepth: 5, timeLimitMs: 1500 }, { maxDepth: 6, timeLimitMs: 2000 }, { maxDepth: 7, timeLimitMs: 2500 },
    { maxDepth: 8, timeLimitMs: 3000 }, { maxDepth: 9, timeLimitMs: 3500 }, { maxDepth: 10, timeLimitMs: 4000 },
    { maxDepth: 11, timeLimitMs: 4500 }, { maxDepth: 12, timeLimitMs: 5000 }, { maxDepth: 13, timeLimitMs: 5500 },
    { maxDepth: 14, timeLimitMs: 6000 },
  ];
  return params[level - 1] || params[4];
}
function captureToReserveAuto(st, captured, captorSide) {
  if (!captured) return;
  const type = captured.promoted ? (captured.type === "pawn" ? "crossbow" : captured.type) : captured.type;
  if (!isReserveType(type)) return;
  st.reserves[captorSide].push({ id: crypto.randomUUID(), type, side: captorSide });
}
function resolveAmbushAuto(ambush, side) {
  if (!ambush) return;
  if (ambush.type === 'autoCaptureAll') { for (const v of ambush.victims) { const p = state.board[v.r]?.[v.c]; if (p) { captureToReserveAuto(state, p, side); state.board[v.r][v.c] = null; } } }
  else if (ambush.type === 'singleCapture') { const p = state.board[ambush.victim.r]?.[ambush.victim.c]; if (p) { captureToReserveAuto(state, p, side); state.board[ambush.victim.r][ambush.victim.c] = null; } }
  else if (ambush.type === 'chooseCapture') {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < ambush.options.length; i++) {
      const opt = ambush.options[i]; let sc = getPieceValue(opt.piece);
      if (!opt.canRetreat) sc += 80; if (isPalaceSquare(opt.r, opt.c, opponent(side))) sc += 120;
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }
    executeArcherAmbush(state, { archerTo: ambush.archerTo, chosenIndex: bestIdx });
  }
}

async function runBotTurn() {
  if (!V.botEnabled || state.status !== "playing" || state.turn !== SIDE.BLACK) {
    V.botThinking = false;
    return;
  }
  V.botThinking = true;
  try {
    const payload = {
      state: serializeState(state),
      difficulty: parseInt(difficultySelect?.value) || 5
    };
    const resp = await fetch('/api/botMove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!data.move) {
      state.message = "Bot has no legal moves.";
      V.botThinking = false;
      render();
      return;
    }

    const chosen = data.move;
    const evalBefore = evaluate(state, computeFullHash(state)).score;
    let notation;
    if (chosen.fromReserve) {
      notation = generateMoveNotation(state, chosen);
      if (!executeDrop(state, chosen.reserveIndex, chosen.to)) return;
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
    } else {
      const piece = state.board[chosen.from.r][chosen.from.c];
      const botMove = { from: chosen.from, to: chosen.to, promotion: chosen.promotion ?? false };
      const capturedPiece = state.board[chosen.to.r][chosen.to.c];
      applyMove(state, botMove);
      if (state.archerAmbush) {
        const ambush = state.archerAmbush; state.archerAmbush = null;
        resolveAmbushAuto(ambush, SIDE.BLACK);
        notation = generateMoveNotation(state, botMove, ambush);
      } else {
        notation = generateMoveNotation(state, botMove, null, 0, capturedPiece);
      }
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
    }
    const evalResult = evaluate(state, computeFullHash(state));
    if (!V.aiVsAiRunning && !V.trainingRunning)
      V.gameMovesData.push(buildMoveData(SIDE.BLACK, chosen, notation, evalBefore, evalResult, state));
    console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
    V.totalMoves++; clearSelection();
    recordTimelineSnapshot();
  } catch (e) {
    console.error('Bot request failed:', e);
    state.message = "Bot error.";
  } finally {
    V.botThinking = false;
    render();
  }
}

export async function init() {
  await loadAdaptiveMemory();
  emptyBoard();
  V.totalMoves = 0;
  V.currentGameNotation = [];
  V.timelineSnapshots = [];
  recordTimelineSnapshot();
  render();
}

function emptyBoard() {
  boardEl.innerHTML = "";
  const cornerTL = document.createElement("div"); cornerTL.className = "coord-corner"; boardEl.appendChild(cornerTL);
  for (let c = 0; c < BOARD_SIZE; c++) { const label = document.createElement("div"); label.className = "coord-letter"; label.textContent = COLS[c]; boardEl.appendChild(label); }
  const cornerTR = document.createElement("div"); cornerTR.className = "coord-corner"; boardEl.appendChild(cornerTR);
  for (let r = 0; r < BOARD_SIZE; r++) {
    const numL = document.createElement("div"); numL.className = "coord-number"; numL.textContent = BOARD_SIZE - r; boardEl.appendChild(numL);
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement("button"); cell.className = "cell"; cell.dataset.r = r; cell.dataset.c = c;
      if ((r + c) % 2 === 1) cell.classList.add("dark");
      if (isRiverSquare(r)) cell.classList.add("river");
      if (isPalaceSquare(r, c, SIDE.BLACK) || isPalaceSquare(r, c, SIDE.WHITE)) cell.classList.add("palace");
      cell.addEventListener("click", onCellClick); boardEl.appendChild(cell);
    }
    const numR = document.createElement("div"); numR.className = "coord-number"; numR.textContent = BOARD_SIZE - r; boardEl.appendChild(numR);
  }
  const cornerBL = document.createElement("div"); cornerBL.className = "coord-corner"; boardEl.appendChild(cornerBL);
  for (let c = 0; c < BOARD_SIZE; c++) { const label = document.createElement("div"); label.className = "coord-letter"; label.textContent = COLS[c]; boardEl.appendChild(label); }
  const cornerBR = document.createElement("div"); cornerBR.className = "coord-corner"; boardEl.appendChild(cornerBR);
}

export function render() {
  const cells = [...boardEl.querySelectorAll(".cell")];
  cells.forEach(cell => {
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    cell.classList.remove("selected", "moveHint", "captureHint");
    const piece = state.board[r][c]; cell.innerHTML = "";
    if (piece) {
      const p = document.createElement("div"); const vis = isVisuallyPromoted(piece);
      p.className = `piece ${piece.side} ${vis ? "promoted" : ""}`;
      const _mo = (promotionModal && !promotionModal.classList.contains("hidden")) || (ambushModal && !ambushModal.classList.contains("hidden"));
      if (!_mo && state.selected?.r === r && state.selected?.c === c) p.classList.add("selected");
      const txt = document.createElement("span");
      if (getPieceStyle() === 'universal') {
        txt.innerHTML = getSVGForPiece(piece.type, piece.promoted);
        txt.style.cssText = 'display:flex;align-items:center;justify-content:center;width:62%;height:62%;';
      } else {
        txt.textContent = getPieceText(piece);
      }
      p.appendChild(txt);      const tag = document.createElement("div"); tag.className = "small";
      let abbrev;
      if (piece.promoted) {
        const promoMap = { tower: "HA", elephant: "FO", priest: "WI", horse: "ST", cannon: "AR", pawn: "CR" };
        abbrev = promoMap[piece.type] || pieceDisplayType(piece).slice(0, 2).toUpperCase();
      } else {
        abbrev = pieceDisplayType(piece).slice(0, 2).toUpperCase();
      }
      tag.textContent = abbrev;
      p.appendChild(tag); cell.appendChild(p);
    }
  });

  const modalOpen = (promotionModal && !promotionModal.classList.contains("hidden"))
                 || (ambushModal    && !ambushModal.classList.contains("hidden"));

  if (!modalOpen) {
    if (V.pendingMove) {
      const sel = cells.find(cell =>
        Number(cell.dataset.r) === V.pendingMove.from.r && Number(cell.dataset.c) === V.pendingMove.from.c
      );
      if (sel) sel.classList.add("selected");
    } else if (state.selected) {
      const sel = cells.find(c => Number(c.dataset.r) === state.selected.r && Number(c.dataset.c) === state.selected.c);
      if (sel) sel.classList.add("selected");
    }

    for (const mv of state.legalMoves) {
      const tgt = cells.find(c => Number(c.dataset.r) === mv.r && Number(c.dataset.c) === mv.c);
      if (tgt) tgt.classList.add(mv.capture ? "captureHint" : "moveHint");
    }
  }

  turnLabel.textContent = `Turn: ${sideName(state.turn)}`;
  phaseLabel.textContent = `Phase: ${state.status === "playing" ? "Game" : state.status}`;
  const moveCountEl = document.getElementById("moveCount"); if (moveCountEl) moveCountEl.textContent = `Moves: ${V.totalMoves}`;
  renderTimeline();
  reserveWhite.innerHTML = ""; reserveBlack.innerHTML = "";
  renderReserve(reserveWhite, SIDE.WHITE); renderReserve(reserveBlack, SIDE.BLACK);
  if (rulesSummary) rulesSummary.innerHTML = `<div>River in row 7.</div><div>Palaces: columns 6 to 8, rows 1 to 3 and 11 to 13.</div><div>Optional promotion when entering the enemy's last three rows.</div><div>Reserve: tower, general, pawn and crossbow.</div>`;
  messageBar.textContent = state.message || ""; messageBar.classList.toggle("hidden", !state.message);
  updateBotButton(); scheduleBotMove();
  if (state.status !== "playing" && !V.aiVsAiRunning && !V.trainingRunning && !V.humanGameFinalized) {
    V.humanGameFinalized = true; finalizeHumanGame();
  }
}

function renderReserve(container, side) {
  const entries = getReserveEntries(state, side); const counts = {};
  for (const e of entries) counts[e.type] = (counts[e.type] || 0) + 1;
  const order = ["tower", "general", "pawn", "crossbow"];
  for (const type of order) {
    const slot = document.createElement("button"); slot.className = "slot"; const count = counts[type] || 0; const vis = type === "crossbow";
    slot.innerHTML = `<div class="piece ${side} ${vis ? "promoted" : ""}" style="position:relative">${pieceGlyph(type)}</div><div class="stack">${typeToName(type)} × ${count}</div>`;
    if (count === 0) slot.classList.add("disabled");
    if (V.selectedReserve?.side === side && V.selectedReserve?.type === type) slot.classList.add("active");
    slot.disabled = count === 0 || state.turn !== side || state.status !== "playing" || V.botThinking;
    slot.addEventListener("click", () => onReserveClick(side, type)); container.appendChild(slot);
  }
}
// DESPUÉS:
function pieceGlyph(type) {
  if (getPieceStyle() === 'universal') {
    const isPromoted = type === 'crossbow';
    return `<span style="display:flex;align-items:center;justify-content:center;width:62%;height:62%;">${getSVGForPiece(type === 'crossbow' ? 'crossbow' : type, isPromoted)}</span>`;
  }
  return { tower:"塔", general:"師", pawn:"兵", crossbow:"弩" }[type] || "?";
}
function typeToName(type) { return { tower:"Tower", general:"General", pawn:"Pawn", crossbow:"crossbow" }[type] || type; }

async function finalizeHumanGame() {
  if (V.gameMovesData.length === 0) return;
  let result = 'draw';
  if (state.status === 'checkmate') {
    result = state.turn === SIDE.WHITE ? 'black_win' : 'white_win';
  } else if (state.status === 'palacemate') {
    result = state.turn === SIDE.WHITE ? 'black_win' : 'white_win';
  } else {
    result = 'draw';
  }
  const movesSnapshot = [...V.gameMovesData]; V.gameMovesData = [];
  await sendGameForLearning(movesSnapshot, state.status, result);
  adaptiveMemory.recordGame(result, movesSnapshot);
  if (result === 'draw') { adaptiveMemory.recordDrawGame(movesSnapshot, state.status); }
  queueAdaptiveMemorySave();
}

function cleanupPromoBar() {
  if (promotionModal) {
    promotionModal.classList.add("hidden");
    if (V._promoCancelListener) {
      promotionModal.removeEventListener('click', V._promoCancelListener);
      V._promoCancelListener = null;
    }
  }
}

function openAmbushModal(ambushResult) {
  state.selected = null;
  state.legalMoves = [];
  render();
  ambushChoices.innerHTML = "";
  V.pendingAmbush = ambushResult;
  ambushText.textContent = `Choose an enemy piece to capture (${ambushResult.options.length} options):`;
  ambushResult.options.forEach((option, index) => {
    const btn = document.createElement("button");
    btn.textContent = `${pieceLabel(option.piece)} en ${COLS[option.c]}${13 - option.r}${option.canRetreat ? " (can retreat)" : " (will be captured)"}`;
    btn.addEventListener("click", () => finalizeAmbush(index));
    ambushChoices.appendChild(btn);
  });
  ambushModal.classList.remove("hidden");
}

function finalizeAmbush(chosenIndex) {
  ambushModal.classList.add("hidden");
  if (!V.pendingAmbush) return;
  const ambush = V.pendingAmbush;
  const archerMove = V.pendingMove ? { from: V.pendingMove.from, to: V.pendingMove.to, promotion: false } : null;
  executeArcherAmbush(state, { archerTo: ambush.archerTo, chosenIndex });
  const notation = archerMove
    ? generateMoveNotation(state, archerMove, ambush, chosenIndex)
    : `A?>${getPieceSymbol(ambush.options[chosenIndex]?.piece?.type ?? '?')}x${COLS[ambush.options[chosenIndex]?.c]}${13 - (ambush.options[chosenIndex]?.r ?? 0)}`;
  V.currentGameNotation.push(notation);
  V.pendingAmbush = null; V.pendingMove = null;
  afterMoveEvaluation(state);
  markLastNotationForCurrentState();
  V.totalMoves++;
  recordTimelineSnapshot();
  console.log(`Turn ${V.totalMoves}: ${notation}`);
  render();
}

function openPromotionModal(piece) {
  state.legalMoves = [];
  render();

  if (promotionTitle) promotionTitle.textContent = "Promotion Available";
  if (promotionText) promotionText.textContent =
    `${typeToName(pieceDisplayType(piece))} can promote. What do you want to do?`;

  if (promotionChoices) {
    promotionChoices.innerHTML = "";

    const btnYes = document.createElement("button");
    btnYes.textContent = "Promote";
    btnYes.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanupPromoBar();
      finalizePromotion(true);
    });

    const btnNo = document.createElement("button");
    btnNo.textContent = "Don't promote";
    btnNo.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanupPromoBar();
      finalizePromotion(false);
    });

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "Cancel";
    btnCancel.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanupPromoBar();
      const from = V.pendingMove?.from;
      V.pendingMove = null;
      if (from) {
        state.selected = { r: from.r, c: from.c };
        state.legalMoves = getPieceMoves(state, from.r, from.c);
        state.message = "Promotion cancelled. Choose a destination.";
      } else {
        clearSelection();
        state.message = "Promotion cancelled.";
      }
      render();
    });

    promotionChoices.appendChild(btnYes);
    promotionChoices.appendChild(btnNo);
    promotionChoices.appendChild(btnCancel);
  }

  if (promotionModal) {
    if (V._promoCancelListener) {
      promotionModal.removeEventListener('click', V._promoCancelListener);
    }
    const cancelOnBackground = (e) => {
      if (e.target === promotionModal) {
        cleanupPromoBar();
        promotionModal.removeEventListener('click', cancelOnBackground);
        V._promoCancelListener = null;
        const from = V.pendingMove?.from;
        V.pendingMove = null;
        if (from) {
          state.selected = { r: from.r, c: from.c };
          state.legalMoves = getPieceMoves(state, from.r, from.c);
          state.message = "Promotion cancelled. Choose a destination.";
        } else {
          clearSelection();
          state.message = "Promotion cancelled.";
        }
        render();
      }
    };
    promotionModal.addEventListener('click', cancelOnBackground);
    V._promoCancelListener = cancelOnBackground;
    promotionModal.classList.remove("hidden");
  }
}

function finalizePromotion(choice) {
  if (!V.pendingMove) return;
  const evalBefore = evaluate(state, computeFullHash(state)).score;
  const move = { from: V.pendingMove.from, to: V.pendingMove.to, promotion: choice };
  const capturedPiece = state.board[move.to.r][move.to.c];
  let notation = generateMoveNotation(state, move, null, 0, capturedPiece);
  applyMove(state, move);
  afterMoveEvaluation(state);
  notation += appendCurseNotation(state);
  V.currentGameNotation.push(notation);
  markLastNotationForCurrentState();
  const evalResult = evaluate(state, computeFullHash(state));
  const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
  if (!V.aiVsAiRunning && !V.trainingRunning)
    V.gameMovesData.push(buildMoveData(sideMoved, move, notation, evalBefore, evalResult, state));
  console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
  V.pendingMove = null; V.totalMoves++; clearSelection(); recordTimelineSnapshot(); render();
}

function onReserveClick(side, type) {
  if (state.turn !== side || state.status !== "playing" || V.botThinking) return;
  if (V.viewPly !== V.totalMoves) goToPly(V.totalMoves);

  if (V.selectedReserve?.side === side && V.selectedReserve?.type === type) {
    V.selectedReserve = null;
    state.legalMoves = [];
    state.message = "Selection cancelled.";
    render();
    return;
  }

  if (state.selected) { clearSelection(); }

  const entries = state.reserves[side];
  const index = entries.findIndex(x => x.type === type);
  if (index === -1) return;

  V.selectedReserve = { side, type, index };
  state.selected = null;

  const drops = getLegalReserveDrops(state, side);
  state.legalMoves = drops
  .filter(d => d.type === type && !isRiverSquare(d.to.r))
  .map(d => ({ r: d.to.r, c: d.to.c, capture: false }));

  state.message = `Reserve selected: ${typeToName(type)}. Choose a legal empty square to place it.`;
  render();
}

function onCellClick(e) {
  // If editor is active, the capture-phase editor handler already processed this click
  // ES: Si el editor está activo, el handler en fase captura ya procesó este click
  if (V.editorActive) return;

  if (state.status !== "playing" || V.botThinking) return;
  if (V.viewPly !== V.totalMoves) goToPly(V.totalMoves);
  const r = Number(e.currentTarget.dataset.r), c = Number(e.currentTarget.dataset.c);

  if (V.pendingMove) {
    if (V.pendingMove.from.r === r && V.pendingMove.from.c === c) {
      const savedFrom = { ...V.pendingMove.from };
      V.pendingMove = null;
      cleanupPromoBar();
      state.selected = { r: savedFrom.r, c: savedFrom.c };
      state.legalMoves = getPieceMoves(state, savedFrom.r, savedFrom.c);
      state.message = "Promotion cancelled. Choose a destination.";
      render();
    }
    return;
  }

  if (V.selectedReserve) {
    const clickedPiece = state.board[r][c];
    if (clickedPiece && clickedPiece.side === state.turn) {
      V.selectedReserve = null;
      state.selected = { r, c };
      state.legalMoves = getPieceMoves(state, r, c);
      state.message = `${sideName(clickedPiece.side)} seleccionó ${pieceLabel(clickedPiece)}.`;
      render();
      return;
    }
    const legalIdx = state.reserves[V.selectedReserve.side].findIndex(x => x.type === V.selectedReserve.type);
    if (legalIdx === -1) { V.selectedReserve = null; render(); return; }
    const evalBefore = evaluate(state, computeFullHash(state)).score;
    const dropMove = { fromReserve: true, reserveIndex: legalIdx, to: { r, c } };
    const dropType = state.reserves[V.selectedReserve.side][legalIdx]?.type;
    const dropSymbol = getPieceSymbol(dropType ?? '?');
    let notation = `${dropSymbol}*${COLS[c]}${13 - r}`;
    const ok = executeDrop(state, legalIdx, { r, c });
    if (!ok) { state.message = "No puedes colocar esa pieza ahí."; render(); return; }
    V.selectedReserve = null;
    afterMoveEvaluation(state);
    notation += appendCurseNotation(state);
    V.currentGameNotation.push(notation);
    markLastNotationForCurrentState();
    const evalResult = evaluate(state, computeFullHash(state));
    const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
    if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, dropMove, notation, evalBefore, evalResult, state));
    console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
    V.totalMoves++; recordTimelineSnapshot(); render(); return;
  }

  const piece = state.board[r][c];

  if (state.selected && state.selected.r === r && state.selected.c === c) {
    clearSelection();
    state.message = "Selection cancelled.";
    render();
    return;
  }

  if (!state.selected) {
    if (piece && piece.side === state.turn) {
      state.selected = { r, c };
      state.legalMoves = getPieceMoves(state, r, c);
      state.message = `${sideName(piece.side)} seleccionó ${pieceLabel(piece)}.`;
      render();
    }
    return;
  }

  const chosenMove = state.legalMoves.find(m => m.r === r && m.c === c);

  if (!chosenMove) {
    if (piece && piece.side === state.turn) {
      state.selected = { r, c };
      state.legalMoves = getPieceMoves(state, r, c);
      state.message = `${sideName(piece.side)} seleccionó ${pieceLabel(piece)}.`;
      render();
    }
    return;
  }

  const from = state.selected, moving = state.board[from.r][from.c];
  const needsPromo = isPromotionAvailableForMove(state, from, { r, c });

  if (needsPromo && isPromotableType(moving.type) && !moving.promoted) {
    V.pendingMove = { from, to: { r, c } };
    openPromotionModal(moving);
    return;
  }

  const evalBefore = evaluate(state, computeFullHash(state)).score;
  const move = { from: { r: from.r, c: from.c }, to: { r, c }, promotion: false };
  const capturedPiece = state.board[r][c];

  applyMove(state, move);

  if (state.archerAmbush) {
    const ambush = state.archerAmbush; state.archerAmbush = null;
    if (ambush.type === 'chooseCapture') {
      V.pendingMove = { from: move.from, to: move.to, promotion: false };
      openAmbushModal(ambush);
      return;
    } else {
      resolveAmbushAuto(ambush, moving.side);
      let notation = generateMoveNotation(state, move, ambush);
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
      const evalResult = evaluate(state, computeFullHash(state));
      const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
      if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, move, notation, evalBefore, evalResult, state));
      console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
      V.totalMoves++; clearSelection(); recordTimelineSnapshot(); render(); return;
    }
  }

  let notation = generateMoveNotation(state, move, null, 0, capturedPiece);
  afterMoveEvaluation(state);
  notation += appendCurseNotation(state);
  V.currentGameNotation.push(notation);
  markLastNotationForCurrentState();
  const evalResult = evaluate(state, computeFullHash(state));
  const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
  if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, move, notation, evalBefore, evalResult, state));
  console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
  V.totalMoves++; clearSelection(); recordTimelineSnapshot(); render();
}

resetBtn.addEventListener("click", () => {
  cancelBotTimer();
  if (state.status !== "playing" && !V.humanGameFinalized) { V.humanGameFinalized = true; finalizeHumanGame(); }
  resetGame(state); clearSelection(); cleanupPromoBar(); state.message = "Game restarted.";
  V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; V.humanGameFinalized = false;
  V.pendingMove = null;
  V.timelineSnapshots = [];
  recordTimelineSnapshot();
  render();
});

if (botToggleBtn) botToggleBtn.addEventListener("click", () => {
  V.botEnabled = !V.botEnabled; cancelBotTimer();
  state.message = V.botEnabled ? "Black bot enabled." : "Black bot disabled."; render();
});

if (aiVsAiBtn) {
  aiVsAiBtn.addEventListener("click", () => {
    if (V.aiVsAiMode) {
      V.aiVsAiRunning = false; V.aiVsAiMode = false;
      aiVsAiBtn.classList.remove("active"); aiVsAiBtn.textContent = "🤖 AI vs AI";
      state.message = "AI vs AI Stopped."; render();
      return;
    }
    V.botEnabled = false; cancelBotTimer();
    if (state.status !== "playing" && !V.humanGameFinalized) { V.humanGameFinalized = true; finalizeHumanGame(); }
    resetGame(state); V.aiVsAiMoves = []; V.aiVsAiRunning = true; V.aiVsAiMode = true;
    V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; V.humanGameFinalized = false;
    V.pendingMove = null;
    aiVsAiBtn.classList.add("active"); aiVsAiBtn.textContent = "⏹ Stop AI vs AI";
    state.message = "🤖 AI vs AI iniciado. Nivel: " + difficultySelect.value;
    render();
    runAiVsAi();
  });
}

async function runAiVsAi() {
  if (!V.aiVsAiMode || !V.aiVsAiRunning) return;
  let moveCount = 0, consecutiveErrors = 0; const MAX_MOVES = 1000;
  while (V.aiVsAiMode && V.aiVsAiRunning && state.status === "playing") {
    moveCount++;
    if (moveCount > MAX_MOVES) { state.status = "draw_move_limit"; state.message = "Draw by movement limit (1000 moves)."; break; }
    const side = state.turn; let legalMoves = [];
    try { legalMoves = getAllLegalMoves(state, side); } catch { state.status = "stalemate"; state.message = "Internal error (unreadable moves)."; break; }
    if (legalMoves.length === 0) { break; }
    await new Promise(resolve => setTimeout(resolve, 300)); if (!V.aiVsAiRunning || state.status !== "playing") break;
    const params = getBotParams(); let chosen = null;
    try {
      const stateCopy = cloneStateForBot(state); const { move } = chooseBlackBotMove(stateCopy, params);
      if (move) {
        if (move.fromReserve) { if (state.reserves[side]?.[move.reserveIndex]) chosen = move; }
        else if (move.from && move.to) { const piece = state.board[move.from.r]?.[move.from.c]; if (piece && piece.side === side) { const legal = getPieceMoves(state, move.from.r, move.from.c); if (legal.some(m => m.r === move.to.r && m.c === move.to.c)) chosen = move; } }
      }
      if (!chosen) { const valid = legalMoves.filter(m => { if (m.fromReserve) return true; const p = state.board[m.from?.r]?.[m.from?.c]; return p && p.side === side; }); chosen = valid[Math.floor(Math.random() * valid.length)] ?? null; }
      if (!chosen) { if (++consecutiveErrors > 3) { state.status = "stalemate"; state.message = "AI without valid moves."; break; } continue; }
      consecutiveErrors = 0;
      const evalBefore = evaluate(state, computeFullHash(state)).score;
      let notation;
      if (!chosen.fromReserve) {
        const piece = state.board[chosen.from.r][chosen.from.c];
        const aiMove = { from: chosen.from, to: chosen.to, promotion: chosen.promotion ?? false };
        const capturedPiece = state.board[chosen.to.r][chosen.to.c];
        applyMove(state, aiMove);
        if (state.archerAmbush) { const ambush = state.archerAmbush; state.archerAmbush = null; resolveAmbushAuto(ambush, side); notation = generateMoveNotation(state, aiMove, ambush); }
        else { notation = generateMoveNotation(state, aiMove, null, 0, capturedPiece); }
      } else {
        notation = generateMoveNotation(state, chosen);
        executeDrop(state, chosen.reserveIndex, chosen.to);
      }
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
      console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
      const evalResult = evaluate(state, computeFullHash(state));
      V.aiVsAiMoves.push(buildMoveData(side, chosen, notation, evalBefore, evalResult, state));
      V.totalMoves++; render();
      if (state.status !== "playing") break;
    } catch (e) { console.error("Error en AI vs AI:", e); if (++consecutiveErrors > 5) { if (state.status === "playing") { state.status = "stalemate"; state.message = "Stopped by internal error."; } break; } state.message = "Retrying after error..."; render(); }
  }
  if (V.aiVsAiMoves.length > 0) {
    let result = 'draw';
    if (state.status === 'checkmate' || state.status === 'palacemate') result = V.aiVsAiMoves[V.aiVsAiMoves.length-1].side === SIDE.BLACK ? 'win' : 'loss';
    const movesSnapshot = [...V.aiVsAiMoves]; V.aiVsAiMoves = [];
    await sendGameForLearning(movesSnapshot, state.status, result);
    adaptiveMemory.recordGame(result, movesSnapshot);
    if (result === 'draw') { adaptiveMemory.recordDrawGame(movesSnapshot, state.status); }
    queueAdaptiveMemorySave();
    const stats = adaptiveMemory.getStats(); state.message = `AI vs AI finished: ${state.status}. Games: ${stats.gamesPlayed}, Win Rate: ${stats.winRate}%`;
    try { localStorage.setItem('aiMemory', JSON.stringify(adaptiveMemory.toJSON())); } catch {}
  }
  V.currentGameNotation = []; V.aiVsAiRunning = false; V.aiVsAiMode = false;
  if (aiVsAiBtn) { aiVsAiBtn.classList.remove("active"); aiVsAiBtn.textContent = "🤖 AI vs AI"; }
  render();
}

if (trainBtn) {
  trainBtn.addEventListener("click", () => {
    if (V.trainingMode) {
      V.trainingMode = false; V.trainingRunning = false; V.aiVsAiRunning = false;
      trainBtn.classList.remove("active"); trainBtn.textContent = "🏋️ Training";
      state.message = "Training stopped"; render();
      return;
    }
    V.trainingMode = true; V.trainingCount = 0; V.trainingRunning = true;
    trainBtn.classList.add("active"); trainBtn.textContent = "⏹ Stop Training";
    V.botEnabled = false; cancelBotTimer(); if (V.aiVsAiRunning) V.aiVsAiRunning = false;
    resetGame(state); V.totalMoves = 0; V.currentGameNotation = []; V.aiVsAiMoves = []; V.gameMovesData = []; V.humanGameFinalized = false;
    V.pendingMove = null;
    state.message = "🏋️ Training started. Level: " + difficultySelect.value;
    render();
    runTrainingGame();
  });
}

async function runTrainingGame() {
  while (V.trainingMode && V.trainingRunning) {
    let moveCount = 0;
    while (V.trainingRunning && state.status === "playing" && moveCount < 1000) {
      moveCount++;
      const side = state.turn;
      const legalMoves = getAllLegalMoves(state, side);
      if (legalMoves.length === 0) { break; }
      await new Promise(resolve => setTimeout(resolve, 300));
      if (!V.trainingRunning) break;
      const params = getBotParams();
      const stateCopy = cloneStateForBot(state);
      const { move } = chooseBlackBotMove(stateCopy, params);
      let chosen = null;
      if (move) {
        if (move.fromReserve && state.reserves[side]?.[move.reserveIndex]) chosen = move;
        else if (move.from && move.to) {
          const piece = state.board[move.from.r]?.[move.from.c];
          if (piece && piece.side === side) {
            const legal = getPieceMoves(state, move.from.r, move.from.c);
            if (legal.some(m => m.r === move.to.r && m.c === move.to.c)) chosen = move;
          }
        }
      }
      if (!chosen) { chosen = legalMoves.filter(m => m.fromReserve || (state.board[m.from?.r]?.[m.from?.c]?.side === side))[0]; }
      if (!chosen) break;
      const evalBefore = evaluate(state, computeFullHash(state)).score;
      let notation;
      if (chosen.fromReserve) {
        notation = generateMoveNotation(state, chosen);
        executeDrop(state, chosen.reserveIndex, chosen.to);
      } else {
        const piece = state.board[chosen.from.r][chosen.from.c];
        const tMove = { from: chosen.from, to: chosen.to, promotion: chosen.promotion ?? false };
        const capturedPiece = state.board[chosen.to.r][chosen.to.c];
        applyMove(state, tMove);
        if (state.archerAmbush) { const ambush = state.archerAmbush; state.archerAmbush = null; resolveAmbushAuto(ambush, side); notation = generateMoveNotation(state, tMove, ambush); }
        else { notation = generateMoveNotation(state, tMove, null, 0, capturedPiece); }
      }
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
      console.log(`Turn ${V.totalMoves + 1}: ${notation}`);
      const evalResult = evaluate(state, computeFullHash(state));
      V.aiVsAiMoves.push(buildMoveData(side, chosen, notation, evalBefore, evalResult, state));
      V.totalMoves++;
      render();
    }
    if (V.aiVsAiMoves.length > 0) {
      let result = 'draw';
      if (state.status === 'checkmate' || state.status === 'palacemate') result = V.aiVsAiMoves[V.aiVsAiMoves.length-1].side === SIDE.BLACK ? 'win' : 'loss';
      await sendGameForLearning(V.aiVsAiMoves, state.status, result);
      adaptiveMemory.recordGame(result, V.aiVsAiMoves);
      if (result === 'draw') { adaptiveMemory.recordDrawGame(V.aiVsAiMoves, state.status); }
      queueAdaptiveMemorySave();
      V.aiVsAiMoves = [];
    }
    if (!V.trainingRunning) break;
    V.trainingCount++;
    if (V.trainingCount >= 10) {
      V.trainingRunning = false;
      const continuar = confirm(`Completed ${V.trainingCount} games. Continue?`);
      if (continuar) { V.trainingCount = 0; V.trainingRunning = true; resetGame(state); V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; state.message = "Training restarted..."; render(); }
      else { V.trainingMode = false; if (trainBtn) { trainBtn.classList.remove("active"); trainBtn.textContent = "🏋️ Training"; } state.message = "Training stopped."; render(); break; }
    } else {
      resetGame(state); V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = [];
      state.message = `Training in progress (${V.trainingCount}/10)...`; render();
    }
  }
  if (V.trainingMode && !V.trainingRunning) {
    V.trainingMode = false;
    if (trainBtn) { trainBtn.classList.remove("active"); trainBtn.textContent = "🏋️ Training"; }
    state.message = "Training stopped."; render();
  }
}