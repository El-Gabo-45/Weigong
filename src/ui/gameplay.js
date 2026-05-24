import {
  SIDE, BOARD_SIZE, pieceLabel, pieceDisplayType, isPalaceSquare, isRiverSquare,
  homePromotionZone, opponent, isPromotableType, isReserveType, RESERVED_DROP_TYPES, onBank,
  PIECE_DATA
} from "../../engine/constants.js";
import {
  renderAnalysisPanel,
  analyzeCurrentPosition,
} from "./analysis-panel.js";
import {
  createGame, resetGame, getPieceMoves, getAllLegalMoves, getReserveEntries,
  applyMove, executeDrop, isPromotionAvailableForMove, afterMoveEvaluation,
  getBoardMeta, getPieceText, executeArcherAmbush, isKingInCheck,
  isPalaceCursedFor, getPalaceInvaders, getLegalReserveDrops,
  getLegalMovesForSquare, isDropLegal,
} from "../../engine/rules/index.js";
import {
  loadAdaptiveMemory,
  evaluate, computeFullHash,
} from "../../engine/ai/index.js";
import {
  state, V,
  cloneStateForBot,
  cancelBotTimer, clearSelection,
  boardEl, turnLabel, phaseLabel, reserveWhite, reserveBlack,
  resetBtn, botToggleBtn, promotionModal, promotionTitle, promotionText, promotionChoices,
  ambushModal, ambushTitle, ambushText, ambushChoices,
  difficultySelect, analysisModeBtn,
  messageBar, rulesSummary, moveTimeline, loadGameBtn, loadGameInput, COLS,
} from "../../engine/state.js";
import {
  recordTimelineSnapshot, renderTimeline, goToPly, markLastNotationForCurrentState,
  snapshotForTimeline,
} from "./timeline.js";
import { getPieceStyle, getSVGForPiece } from "./piece-style-selector.js";
import { getPieceSymbol, generateMoveNotation, appendCurseNotation } from "./move-notation.js";
import { buildMoveData } from "./board-snapshot.js";
import { finalizeHumanGame } from "./game-learning.js";
import {
  resolveAmbushAuto,
  updateBotButton, scheduleBotMove,
} from "./bot-player.js";

const STATS_KEY = 'gameStats13x13';
function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || { white: 0, black: 0, draw: 0 }; }
  catch { return { white: 0, black: 0, draw: 0 }; }
}
function saveStats(s) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch {}
}
function recordResult(result) {
  const s = loadStats();
  if (result === 'white_win') s.white++;
  else if (result === 'black_win') s.black++;
  else s.draw++;
  saveStats(s);
}
function getResultFromStatus() {
  if (state.status === 'checkmate' || state.status === 'palacemate') {
    return state.turn === SIDE.WHITE ? 'black_win' : 'white_win';
  }
  return 'draw';
}

function sideName(side) { return side === SIDE.WHITE ? "White" : "Black"; }
function isVisuallyPromoted(p) { return p.promoted || p.type === "crossbow"; }

export async function init() {
  await loadAdaptiveMemory();
  resetGame(state);
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
  if (rulesSummary) {
    const _st = loadStats();
    const _total = _st.white + _st.black + _st.draw;
    rulesSummary.innerHTML = `
      <div>River in row 7.</div>
      <div>Palaces: columns 6 to 8, rows 1-3 and 11-13.</div>
      <div>Optional promotion entering enemy's last 3 rows.</div>
      <div>Reserve: tower, general, pawn and crossbow.</div>
      <hr style="border-color:var(--line);margin:8px 0;">
      <div style="font-weight:700;margin-bottom:6px;">Results (${_total} games)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center;margin-bottom:8px;">
        <div style="background:rgba(255,255,255,.07);border-radius:8px;padding:6px 4px;">
          <div style="font-size:1.15rem;font-weight:700;color:#f4f4f4;">${_st.white}</div>
          <div style="font-size:0.7rem;color:var(--muted);">White</div>
        </div>
        <div style="background:rgba(255,255,255,.07);border-radius:8px;padding:6px 4px;">
          <div style="font-size:1.15rem;font-weight:700;color:var(--muted);">${_st.draw}</div>
          <div style="font-size:0.7rem;color:var(--muted);">Draw</div>
        </div>
        <div style="background:rgba(255,255,255,.07);border-radius:8px;padding:6px 4px;">
          <div style="font-size:1.15rem;font-weight:700;color:#f4f4f4;background:#222;border-radius:6px;padding:1px 0;">${_st.black}</div>
          <div style="font-size:0.7rem;color:var(--muted);">Black</div>
        </div>
      </div>
      <button id="resetStatsBtn" style="width:100%;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:4px;font-size:0.75rem;cursor:pointer;">Reset stats</button>
    `;
    document.getElementById('resetStatsBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      saveStats({ white: 0, black: 0, draw: 0 });
      render();
    });
  }
  messageBar.textContent = state.message || ""; messageBar.classList.toggle("hidden", !state.message);
  updateBotButton();
  if (V.analysisMode) {
    renderAnalysisPanel();
    const currentHash = computeFullHash(state).toString();
    if (currentHash !== V.lastAnalyzedHash) {
      V.lastAnalyzedHash = currentHash;
      V.analysisNNScore = null;
      analyzeCurrentPosition();
    }
  } else {
    renderAnalysisPanel();
  }
  // If bot is enabled, schedule its move after render
  scheduleBotMove();
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
  if (state.status !== "playing" && !V.humanGameFinalized) { V.humanGameFinalized = true; finalizeHumanGame(); recordResult(getResultFromStatus()); }
  resetGame(state); clearSelection(); cleanupPromoBar(); state.message = "Game restarted.";
  V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; V.humanGameFinalized = false;
  V.pendingMove = null;
  V.timelineSnapshots = [];
  V.lastAnalyzedHash = null;
  V.analysisResult = null;
  recordTimelineSnapshot();
  render();
});

if (botToggleBtn) botToggleBtn.addEventListener("click", () => {
  V.botEnabled = !V.botEnabled; cancelBotTimer();
  state.message = V.botEnabled ? "Black bot enabled." : "Black bot disabled."; render();
});

if (analysisModeBtn) {
  analysisModeBtn.addEventListener("click", () => {
    V.analysisMode = !V.analysisMode;
    if (V.analysisMode) {
      V.analysisPositionHash = null;
      analysisModeBtn.textContent = "🧠 Analysis: ON";
      analysisModeBtn.classList.add("active");
      state.message = "Analysis mode activated. Use the timeline or reload a finished game to inspect positions.";
      analyzeCurrentPosition();
    } else {
      analysisModeBtn.textContent = "🧠 Analysis mode";
      analysisModeBtn.classList.remove("active");
      state.message = "Analysis mode disabled.";
    }
    render();
  });
}