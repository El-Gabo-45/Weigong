import { SIDE, isPalaceSquare, isReserveType, opponent } from "../../engine/constants.js";
import {
  state, V, clearSelection, cloneStateForBot, cancelBotTimer,
  difficultySelect, botToggleBtn,
} from "../../engine/state.js";
import {
  getAllLegalMoves, getPieceMoves, applyMove, executeDrop, executeArcherAmbush,
  afterMoveEvaluation,
} from "../../engine/rules/index.js";
import { evaluate, computeFullHash } from "../../engine/ai/index.js";
import { getPieceValue, generateMoveNotation, appendCurseNotation } from "./move-notation.js";
import { buildMoveData, serializeState } from "./board-snapshot.js";
import { recordTimelineSnapshot, markLastNotationForCurrentState } from "./timeline.js";
import { render } from "./gameplay.js";

function captureToReserveAuto(st, captured, captorSide) {
  if (!captured) return;
  const type = captured.promoted ? (captured.type === "pawn" ? "crossbow" : captured.type) : captured.type;
  if (!isReserveType(type)) return;
  st.reserves[captorSide].push({ id: crypto.randomUUID(), type, side: captorSide });
}

function isSameMove(move, legalMove) {
  if (!move || !legalMove) return false;
  if (Boolean(move.fromReserve) !== Boolean(legalMove.fromReserve)) return false;
  if (move.fromReserve) {
    return move.reserveIndex === legalMove.reserveIndex && move.to.r === legalMove.to.r && move.to.c === legalMove.to.c;
  }
  // Don't compare promotion flag — promotion comes from the bot's decision,
  // not from legalMoves which don't carry it. Match only from/to.
  return move.from?.r === legalMove.from?.r && move.from?.c === legalMove.from?.c &&
         move.to?.r === legalMove.to?.r && move.to?.c === legalMove.to?.c;
}

function isBotMoveValid(state, move) {
  if (!move) return false;
  const legalMoves = getAllLegalMoves(state, state.turn);
  return legalMoves.some(m => isSameMove(move, m));
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

    let chosen = data.move;
    if (!isBotMoveValid(state, chosen)) {
      const legalMoves = getAllLegalMoves(state, state.turn);
      console.warn('Bot returned invalid move, using fallback. received:', chosen, 'legalMoves:', legalMoves.length);
      if (legalMoves.length > 0) {
        const fm = legalMoves[0];
        chosen = fm.fromReserve
          ? { fromReserve: true, reserveIndex: fm.reserveIndex, to: { r: fm.to.r, c: fm.to.c }, promotion: fm.promotion ?? false }
          : { from: { r: fm.from.r, c: fm.from.c }, to: { r: fm.to.r, c: fm.to.c }, promotion: fm.promotion ?? false };
      } else {
        console.error('Bot error: no legal fallback moves available.');
        state.message = "Bot error: no hay movimientos legales.";
        V.botThinking = false;
        render();
        return;
      }
    }
    const evalBefore = evaluate(state, computeFullHash(state)).score;
    let notation;
    if (chosen.fromReserve) {
      notation = generateMoveNotation(state, chosen);
      if (!executeDrop(state, chosen.reserveIndex, chosen.to)) {
        state.message = "Bot error: caída inválida.";
        V.botThinking = false;
        render();
        return;
      }
      afterMoveEvaluation(state);
      notation += appendCurseNotation(state);
      V.currentGameNotation.push(notation);
      markLastNotationForCurrentState();
    } else {
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

export {
  captureToReserveAuto, isSameMove, isBotMoveValid, resolveAmbushAuto,
  getBotParams, updateBotButton, scheduleBotMove, runBotTurn,
};