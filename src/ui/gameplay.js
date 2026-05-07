import {
  SIDE, BOARD_SIZE, pieceLabel, pieceDisplayType, isPalaceSquare, isRiverSquare,
  homePromotionZone, opponent, isPromotableType, isReserveType, RESERVED_DROP_TYPES, onBank,
  PIECE_DATA
} from "../constants.js";
import {
  createGame, resetGame, getPieceMoves, getAllLegalMoves, getReserveEntries,
  applyMove, executeDrop, isPromotionAvailableForMove, afterMoveEvaluation,
  getBoardMeta, getPieceText, executeArcherAmbush, isKingInCheck,
  isPalaceCursedFor, getPalaceInvaders,
} from "../rules/index.js";
import {
  chooseBlackBotMove, adaptiveMemory, loadAdaptiveMemory,
  evaluate, computeFullHash, extractFeatures, moveKey,
  gamePhaseFactor, queueAdaptiveMemorySave,
} from "../ai/index.js";
import {
  state, V,
  cloneStateForBot,
  cancelBotTimer, clearSelection,
  boardEl, turnLabel, phaseLabel, reserveWhite, reserveBlack,
  resetBtn, botToggleBtn, promotionModal, promotionTitle, promotionText, promotionChoices,
  ambushModal, ambushTitle, ambushText, ambushChoices,
  difficultySelect, aiVsAiBtn, trainBtn, messageBar, rulesSummary, moveTimeline,
  loadGameBtn, loadGameInput, COLS,
} from "../state.js";
import {
  recordTimelineSnapshot, renderTimeline, goToPly, markLastNotationForCurrentState,
  snapshotForTimeline,
} from "./timeline.js";

// ── Funciones auxiliares ──
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

  const piece = state.board[move.to.r]?.[move.to.c]
             ?? state.board[move.from.r]?.[move.from.c];
  if (!piece) return '?';

  // ── Símbolos para piezas promocionadas ──
  const PROMO_SYMBOLS = {
    tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B'
  };
  const sym = piece.promoted
    ? (PROMO_SYMBOLS[piece.type] ?? getPieceSymbol(piece.type))
    : getPieceSymbol(piece.type);

  // ── Notación del arquero ──
  if (piece.type === 'archer' && ambushInfo) {
    let nota = `A${toStr}`;

    if (ambushInfo.type === 'singleCapture') {
      const v = ambushInfo.victim;
      const vPiece = ambushInfo.victimPiece;
      const vSym   = vPiece
        ? (vPiece.promoted ? (PROMO_SYMBOLS[vPiece.type] ?? getPieceSymbol(vPiece.type)) : getPieceSymbol(vPiece.type))
        : '?';
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
        const cSym   = chosen.piece.promoted
          ? (PROMO_SYMBOLS[chosen.piece.type] ?? getPieceSymbol(chosen.piece.type))
          : getPieceSymbol(chosen.piece.type);
        nota += `>${cSym}x${COLS[chosen.c]}${13 - chosen.r}`;
        for (let i = 0; i < opts.length; i++) {
          if (i === chosenAmbushIndex) continue;
          const opt  = opts[i];
          const oSym = opt.piece.promoted
            ? (PROMO_SYMBOLS[opt.piece.type] ?? getPieceSymbol(opt.piece.type))
            : getPieceSymbol(opt.piece.type);
          if (opt.canRetreat) {
            const retreatDir = piece.side === SIDE.BLACK ? 1 : -1;
            const rr = opt.r + retreatDir;
            // ★ Casilla de origen antes de la flecha
            nota += `,${oSym}${COLS[opt.c]}${13 - opt.r}→${COLS[opt.c]}${13 - rr}`;
          } else {
            nota += `,${oSym}x${COLS[opt.c]}${13 - opt.r}`;
          }
        }
      }
    }
    return nota;
  }

  // ── Notación normal ──
  const target = capturedPiece || state.board[move.to.r]?.[move.to.c];
  let notation = sym;
  if (target && target.side !== piece.side) {
    const targetSym = target.promoted
      ? (PROMO_SYMBOLS[target.type] ?? getPieceSymbol(target.type))
      : getPieceSymbol(target.type);
    notation += `x${targetSym.toLowerCase()}${toStr}`;
  } else {
    notation += toStr;
  }
  if (move.promotion) notation += '+';
  return notation;
}

// ── Palace curse notation suffix ──
// Appends invaders info when curse JUST activated, e.g. "pJ4&BG11-"
function appendCurseNotation(state) {
  const PROMO_SYMBOLS = {
    tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B'
  };
  let suffix = '';
  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const curse = state.palaceCurse?.[side];
    if (curse?.justActivated && curse.curseActivators) {
      const parts = [];
      for (const act of curse.curseActivators) {
        // Use promoted symbol if piece is promoted (e.g. pawn→crossbow = 'B')
        const sym = act.promoted
          ? (PROMO_SYMBOLS[act.type] ?? getPieceSymbol(act.type))
          : getPieceSymbol(act.type);
        const loc = `${COLS[act.c]}${13 - act.r}`;
        parts.push(`${sym}${loc}`);
      }
      suffix += parts.join('&') + '-';
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

// ── NN encoding (same as selfplay.js) ──
const PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
};
const NN_CHANNELS = 24;
const NN_SIZE     = BOARD_SIZE * BOARD_SIZE * NN_CHANNELS;

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

function buildMoveData(side, move, notation, evalBefore, evalResult, stateAfter) {
  const { score: evalAfter, metrics } = evalResult;
  const featureKey = extractFeatures(stateAfter, side);
  const positionHash = computeFullHash(stateAfter).toString();
  const nnEncoding = encodeBoardForNN(stateAfter.board);
  const snap = boardSnapshot(stateAfter.board);
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
    })),
  };
  try {
    await fetch('/api/saveGame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gameData) });
    await fetch('/api/learnFromGames', { method: 'POST' });
  } catch (e) { console.error('Error guardando/aprendiendo:', e); }
}

// ── Utilidades generales ──
function sideName(side) { return side === SIDE.WHITE ? "Blanco" : "Negro"; }
function isVisuallyPromoted(p) { return p.promoted || p.type === "crossbow"; }
function updateBotButton() {
  if (!botToggleBtn) return;
  botToggleBtn.textContent = V.botEnabled ? "Bot negras: activado" : "Bot negras: desactivado";
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
    { maxDepth: 1, timeLimitMs: 200 }, { maxDepth: 2, timeLimitMs: 300 }, { maxDepth: 2, timeLimitMs: 500 },
    { maxDepth: 3, timeLimitMs: 500 }, { maxDepth: 3, timeLimitMs: 800 }, { maxDepth: 4, timeLimitMs: 800 },
    { maxDepth: 4, timeLimitMs: 1200 }, { maxDepth: 5, timeLimitMs: 1500 }, { maxDepth: 6, timeLimitMs: 2000 },
    { maxDepth: 8, timeLimitMs: 3000 },
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

// ── Bot individual ──
function runBotTurn() {
  if (!V.botEnabled || state.status !== "playing" || state.turn !== SIDE.BLACK) { V.botThinking = false; return; }
  try {
    const stateCopy = cloneStateForBot(state); const params = getBotParams(); const { move } = chooseBlackBotMove(stateCopy, params);
    const fallbackMoves = getAllLegalMoves(state, SIDE.BLACK); let chosen = null;
    if (move) {
      if (move.fromReserve) { const entry = state.reserves[SIDE.BLACK]?.[move.reserveIndex]; if (entry) chosen = move; }
      else if (move.from && move.to) { const piece = state.board[move.from.r]?.[move.from.c]; if (piece && piece.side === SIDE.BLACK) { const legal = getPieceMoves(state, move.from.r, move.from.c); if (legal.some(m => m.r === move.to.r && m.c === move.to.c)) chosen = move; } }
    }
    if (!chosen) chosen = fallbackMoves.find(m => { if (m.fromReserve) return true; const p = state.board[m.from?.r]?.[m.from?.c]; return p && p.side === SIDE.BLACK; }) ?? fallbackMoves[0] ?? null;
    if (!chosen) return;
    if (!chosen.fromReserve) { const p = state.board[chosen.from?.r]?.[chosen.from?.c]; if (!p || p.side !== SIDE.BLACK) return; }

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
      const shouldProm = chosen.from && chosen.to
        && isPromotionAvailableForMove(state, chosen.from, chosen.to)
        && isPromotableType(piece.type)
        && !piece.promoted;
      const botMove = { from: chosen.from, to: chosen.to, promotion: shouldProm };
      const capturedPiece = state.board[chosen.to.r][chosen.to.c];  // ← guardar antes de mover
      applyMove(state, botMove);
      if (state.archerAmbush) {
        const ambush = state.archerAmbush; state.archerAmbush = null;
        resolveAmbushAuto(ambush, SIDE.BLACK);
        notation = generateMoveNotation(state, botMove, ambush);
      } else {
        notation = generateMoveNotation(state, botMove, null, 0, capturedPiece);  // ← pasar pieza capturada
      }
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
    }
    const evalResult = evaluate(state, computeFullHash(state));
    if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(SIDE.BLACK, chosen, notation, evalBefore, evalResult, state));
    console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
    V.totalMoves++; clearSelection();
    recordTimelineSnapshot();
  } finally { V.botThinking = false; render(); }
}

// ── Inicialización exportable para main ──
export async function init() {
  await loadAdaptiveMemory();
  emptyBoard();
  V.totalMoves = 0;
  V.currentGameNotation = [];
  V.timelineSnapshots = [];
  recordTimelineSnapshot();
  render();
}

// ── Renderizado ──
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
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c); cell.classList.remove("selected", "moveHint", "captureHint");
    const piece = state.board[r][c]; cell.innerHTML = "";
    if (piece) {
      const p = document.createElement("div"); const vis = isVisuallyPromoted(piece);
      p.className = `piece ${piece.side} ${vis ? "promoted" : ""}`;
      if (state.selected?.r === r && state.selected?.c === c) p.classList.add("selected");
      const txt = document.createElement("span"); txt.textContent = getPieceText(piece); p.appendChild(txt);
      const tag = document.createElement("div"); tag.className = "small";
      let abbrev;
      if (piece.promoted) {
        const promoMap = { tower: "HA", elephant: "FO", priest: "WI", horse: "ST", cannon: "AR", pawn: "BA" };
        abbrev = promoMap[piece.type] || pieceDisplayType(piece).slice(0, 2).toUpperCase();
      } else {
        abbrev = pieceDisplayType(piece).slice(0, 2).toUpperCase();
      }
      tag.textContent = abbrev;
      p.appendChild(tag); cell.appendChild(p);
    }
  });
  if (state.selected) {
    const sel = cells.find(c => Number(c.dataset.r) === state.selected.r && Number(c.dataset.c) === state.selected.c);
    if (sel) sel.classList.add("selected");
    for (const mv of state.legalMoves) { const tgt = cells.find(c => Number(c.dataset.r) === mv.r && Number(c.dataset.c) === mv.c); if (tgt) tgt.classList.add(mv.capture ? "captureHint" : "moveHint"); }
  }
  turnLabel.textContent = `Turno: ${sideName(state.turn)}`; phaseLabel.textContent = `Fase: ${state.status === "playing" ? "Juego" : state.status}`;
  const moveCountEl = document.getElementById("moveCount"); if (moveCountEl) moveCountEl.textContent = `Jugadas: ${V.totalMoves}`;
  renderTimeline();
  reserveWhite.innerHTML = ""; reserveBlack.innerHTML = "";
  renderReserve(reserveWhite, SIDE.WHITE); renderReserve(reserveBlack, SIDE.BLACK);
  if (rulesSummary) rulesSummary.innerHTML = `<div>Río en la fila 7.</div><div>Palacios: columnas 6 a 8, filas 1 a 3 y 11 a 13.</div><div>Promoción opcional al entrar en las 3 últimas filas enemigas.</div><div>Reserva: torre, general, peón y crossbow.</div>`;
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
function pieceGlyph(type) { return { tower:"塔", general:"師", pawn:"兵", crossbow:"弩" }[type] || "?"; }
function typeToName(type) { return { tower:"Torre", general:"General", pawn:"Peón", crossbow:"crossbow" }[type] || type; }

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

// ── Modales ──
function openAmbushModal(ambushResult) {
  state.selected = null;
  state.legalMoves = [];
  render();

  ambushChoices.innerHTML = "";
  V.pendingAmbush = ambushResult;
  ambushText.textContent = `Elige qué pieza enemiga capturar (${ambushResult.options.length} opciones):`;
  ambushResult.options.forEach((option, index) => {
    const btn = document.createElement("button");
    btn.textContent = `${pieceLabel(option.piece)} en ${COLS[option.c]}${13 - option.r}${option.canRetreat ? " (puede retroceder)" : " (será capturada)"}`;
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
  console.log(`Turno ${V.totalMoves}: ${notation}`);
  render();
}
function openPromotionModal(piece) {
  state.selected = null;
  state.legalMoves = [];
  render();

  promotionChoices.innerHTML = "";
  promotionTitle.textContent = `Promoción para ${typeToName(pieceDisplayType(piece))}`;
  promotionText.textContent = "Esta pieza entra en zona de promoción. Puedes elegir promocionar o conservar su estado base.";
  const noBtn = document.createElement("button"); noBtn.textContent = "No promocionar";
  const yesBtn = document.createElement("button"); yesBtn.textContent = "Promocionar";
  noBtn.addEventListener("click", () => finalizePromotion(false));
  yesBtn.addEventListener("click", () => finalizePromotion(true));
  promotionChoices.append(noBtn, yesBtn);
  promotionModal.classList.remove("hidden");
}
function finalizePromotion(choice) {
  promotionModal.classList.add("hidden"); if (!V.pendingMove) return;
  const evalBefore = evaluate(state, computeFullHash(state)).score;
  const move = { from: V.pendingMove.from, to: V.pendingMove.to, promotion: choice };
  const capturedPiece = state.board[move.to.r][move.to.c];  // ← capturar antes de mover
  let notation = generateMoveNotation(state, move, null, 0, capturedPiece);
  applyMove(state, move);
  afterMoveEvaluation(state);
  notation += appendCurseNotation(state);
  markLastNotationForCurrentState();
  const evalResult = evaluate(state, computeFullHash(state)); const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
  if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, move, notation, evalBefore, evalResult, state));
  console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
  V.pendingMove = null; V.totalMoves++; clearSelection(); recordTimelineSnapshot(); render();
}

// ── Eventos de clic ──
function onReserveClick(side, type) {
  if (state.turn !== side || state.status !== "playing" || V.botThinking) return;
  if (V.viewPly !== V.totalMoves) goToPly(V.totalMoves);
  const entries = state.reserves[side]; const index = entries.findIndex(x => x.type === type); if (index === -1) return;
  V.selectedReserve = { side, type, index }; state.selected = null; state.legalMoves = []; state.message = `Reserva seleccionada: ${typeToName(type)}. Elige una casilla vacía legal para colocarla.`; render();
}
function onCellClick(e) {
  if (state.status !== "playing" || V.botThinking) return;
  if (V.viewPly !== V.totalMoves) goToPly(V.totalMoves);
  const r = Number(e.currentTarget.dataset.r), c = Number(e.currentTarget.dataset.c);
  if (V.selectedReserve) {
    const legalIdx = state.reserves[V.selectedReserve.side].findIndex(x => x.type === V.selectedReserve.type); if (legalIdx === -1) { V.selectedReserve = null; render(); return; }
    const evalBefore = evaluate(state, computeFullHash(state)).score; const dropMove = { fromReserve: true, reserveIndex: legalIdx, to: { r, c } };
    const ok = executeDrop(state, legalIdx, { r, c }); if (!ok) { state.message = "No puedes colocar esa pieza ahí."; render(); return; }
    let notation = generateMoveNotation(state, dropMove); V.selectedReserve = null;
    afterMoveEvaluation(state);
    notation += appendCurseNotation(state);
    V.currentGameNotation.push(notation);
    markLastNotationForCurrentState();
    const evalResult = evaluate(state, computeFullHash(state)); const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
    if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, dropMove, notation, evalBefore, evalResult, state));
    console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
    V.totalMoves++; recordTimelineSnapshot(); render(); return;
  }
  const piece = state.board[r][c];
  if (!state.selected) {
    if (piece && piece.side === state.turn) { state.selected = { r, c }; state.legalMoves = getPieceMoves(state, r, c); state.message = `${sideName(piece.side)} seleccionó ${pieceLabel(piece)}.`; render(); } return;
  }
  if (state.selected.r === r && state.selected.c === c) { clearSelection(); state.message = "Selección cancelada."; render(); return; }
  const chosenMove = state.legalMoves.find(m => m.r === r && m.c === c);
  if (!chosenMove) { if (piece && piece.side === state.turn) { state.selected = { r, c }; state.legalMoves = getPieceMoves(state, r, c); state.message = `${sideName(piece.side)} seleccionó ${pieceLabel(piece)}.`; render(); } return; }
  const from = state.selected, moving = state.board[from.r][from.c];
  const needsPromo = isPromotionAvailableForMove(state, from, { r, c });
  if (needsPromo && isPromotableType(moving.type) && !moving.promoted) { V.pendingMove = { from, to: { r, c } }; openPromotionModal(moving); return; }
  const evalBefore = evaluate(state, computeFullHash(state)).score;
  const move = { from: { r: from.r, c: from.c }, to: { r, c }, promotion: false };
  const capturedPiece = state.board[r][c];  // ← se guarda antes de mover

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
      const evalResult = evaluate(state, computeFullHash(state)); const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
      if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, move, notation, evalBefore, evalResult, state));
      console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
      V.totalMoves++; clearSelection(); recordTimelineSnapshot(); render(); return;
    }
  }

  let notation = generateMoveNotation(state, move, null, 0, capturedPiece);  // ← pasar pieza capturada
  afterMoveEvaluation(state);
  notation += appendCurseNotation(state);
  V.currentGameNotation.push(notation);
  markLastNotationForCurrentState();
  const evalResult = evaluate(state, computeFullHash(state)); const sideMoved = state.turn === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
  if (!V.aiVsAiRunning && !V.trainingRunning) V.gameMovesData.push(buildMoveData(sideMoved, move, notation, evalBefore, evalResult, state));
  console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
  V.totalMoves++; clearSelection(); recordTimelineSnapshot(); render();
}

// ── Botones ──
resetBtn.addEventListener("click", () => {
  cancelBotTimer();
  if (state.status !== "playing" && !V.humanGameFinalized) { V.humanGameFinalized = true; finalizeHumanGame(); }
  resetGame(state); clearSelection(); state.message = "Partida reiniciada.";
  V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; V.humanGameFinalized = false;
  V.timelineSnapshots = [];
  recordTimelineSnapshot();
  render();
});
if (botToggleBtn) botToggleBtn.addEventListener("click", () => { V.botEnabled = !V.botEnabled; cancelBotTimer(); state.message = V.botEnabled ? "Bot negro activado." : "Bot negro desactivado."; render(); });

// ── IA vs IA ──
if (aiVsAiBtn) {
  aiVsAiBtn.addEventListener("click", () => {
    if (V.aiVsAiMode) {
      V.aiVsAiRunning = false; V.aiVsAiMode = false;
      aiVsAiBtn.classList.remove("active"); aiVsAiBtn.textContent = "🤖 IA vs IA";
      state.message = "IA vs IA detenido."; render();
      return;
    }
    V.botEnabled = false; cancelBotTimer();
    if (state.status !== "playing" && !V.humanGameFinalized) { V.humanGameFinalized = true; finalizeHumanGame(); }
    resetGame(state); V.aiVsAiMoves = []; V.aiVsAiRunning = true; V.aiVsAiMode = true;
    V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; V.humanGameFinalized = false;
    aiVsAiBtn.classList.add("active"); aiVsAiBtn.textContent = "⏹ Detener IA vs IA";
    state.message = "🤖 IA vs IA iniciado. Nivel: " + difficultySelect.value;
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
        const shouldProm = chosen.from && chosen.to
          && isPromotionAvailableForMove(state, chosen.from, chosen.to)
          && isPromotableType(piece.type)
          && !piece.promoted;
        const aiMove = { from: chosen.from, to: chosen.to, promotion: shouldProm };
        const capturedPiece = state.board[chosen.to.r][chosen.to.c];  // ← guardar antes de mover
        applyMove(state, aiMove);
        if (state.archerAmbush) { const ambush = state.archerAmbush; state.archerAmbush = null; resolveAmbushAuto(ambush, side); notation = generateMoveNotation(state, aiMove, ambush); }
        else { notation = generateMoveNotation(state, aiMove, null, 0, capturedPiece); }  // ← pasar capturada
      } else {
        notation = generateMoveNotation(state, chosen);
        executeDrop(state, chosen.reserveIndex, chosen.to);
      }
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
      const evalResult = evaluate(state, computeFullHash(state));
      V.aiVsAiMoves.push(buildMoveData(side, chosen, notation, evalBefore, evalResult, state));
      V.totalMoves++; render();
      if (state.status !== "playing") break;
    } catch (e) { console.error("Error en IA vs IA:", e); if (++consecutiveErrors > 5) { if (state.status === "playing") { state.status = "stalemate"; state.message = "Stopped by internal error."; } break; } state.message = "Retrying after error..."; render(); }
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
  if (aiVsAiBtn) { aiVsAiBtn.classList.remove("active"); aiVsAiBtn.textContent = "🤖 IA vs IA"; }
  render();
}

// ── ENTRENAMIENTO ──
if (trainBtn) {
  trainBtn.addEventListener("click", () => {
    if (V.trainingMode) {
      V.trainingMode = false; V.trainingRunning = false; V.aiVsAiRunning = false;
      trainBtn.classList.remove("active"); trainBtn.textContent = "🏋️ Training";
      state.message = "Training stopped"; render();
      return;
    }
    V.trainingMode = true; V.trainingCount = 0; V.trainingRunning = true;
    trainBtn.classList.add("active"); trainBtn.textContent = "⏹ Detener entrenamiento";
    V.botEnabled = false; cancelBotTimer(); if (V.aiVsAiRunning) V.aiVsAiRunning = false;
    resetGame(state); V.totalMoves = 0; V.currentGameNotation = []; V.aiVsAiMoves = []; V.gameMovesData = []; V.humanGameFinalized = false;
    state.message = "🏋️ Training started. Level: " + difficultySelect.value;
    render();
    runTrainingGame();
  });
}
async function runTrainingGame() {
  while (V.trainingMode && V.trainingRunning) {
    let moveCount = 0, consecutiveErrors = 0;
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
        V.currentGameNotation.push(notation);
        executeDrop(state, chosen.reserveIndex, chosen.to);
      } else {
        const piece = state.board[chosen.from.r][chosen.from.c];
        const shouldProm = chosen.from && chosen.to
          && isPromotionAvailableForMove(state, chosen.from, chosen.to)
          && isPromotableType(piece.type)
          && !piece.promoted;
        const tMove = { from: chosen.from, to: chosen.to, promotion: shouldProm };
        const capturedPiece = state.board[chosen.to.r][chosen.to.c];  // ← guardar antes de mover
        applyMove(state, tMove);
        if (state.archerAmbush) { const ambush = state.archerAmbush; state.archerAmbush = null; resolveAmbushAuto(ambush, side); notation = generateMoveNotation(state, tMove, ambush); }
        else { notation = generateMoveNotation(state, tMove, null, 0, capturedPiece); }  // ← pasar capturada
        V.currentGameNotation.push(notation);
      }

      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      console.log(`Turno ${V.totalMoves + 1}: ${notation}`);
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
  if (V.trainingMode && !V.trainingRunning) { V.trainingMode = false; if (trainBtn) { trainBtn.classList.remove("active"); trainBtn.textContent = "🏋️ Training"; } state.message = "Training stopped."; render(); }
}