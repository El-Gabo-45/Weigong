import { SIDE } from "../../engine/constants.js";
import {
  state, V, clearSelection, cloneStateForBot, cancelBotTimer,
  difficultySelect, aiVsAiBtn, trainBtn,
} from "../../engine/state.js";
import {
  getAllLegalMoves, applyMove, executeDrop, afterMoveEvaluation, resetGame,
} from "../../engine/rules/index.js";
import {
  evaluate, computeFullHash, chooseBlackBotMove,
  adaptiveMemory, queueAdaptiveMemorySave,
} from "../../engine/ai/index.js";
import { getPieceValue, generateMoveNotation, appendCurseNotation } from "./move-notation.js";
import { buildMoveData } from "./board-snapshot.js";
import { sendGameForLearning, finalizeHumanGame } from "./game-learning.js";
import { recordTimelineSnapshot, markLastNotationForCurrentState } from "./timeline.js";
import { render } from "./gameplay.js";
import { isSameMove, resolveAmbushAuto, getBotParams, resetDanceTracker } from "./bot-player.js";

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
        chosen = legalMoves.find(m => isSameMove(move, m)) ?? null;
      }
      if (!chosen) { chosen = legalMoves[Math.floor(Math.random() * legalMoves.length)] ?? null; }
      if (!chosen) { if (++consecutiveErrors > 3) { state.status = "stalemate"; state.message = "AI without valid moves."; break; } continue; }
      consecutiveErrors = 0;
      const evalBefore = evaluate(state, computeFullHash(state)).score;
      let notation;
      if (!chosen.fromReserve) {
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
        chosen = legalMoves.find(m => isSameMove(move, m)) ?? null;
      }
      if (!chosen) { chosen = legalMoves[0] ?? null; }
      if (!chosen) break;
      const evalBefore = evaluate(state, computeFullHash(state)).score;
      let notation;
      if (chosen.fromReserve) {
        notation = generateMoveNotation(state, chosen);
        executeDrop(state, chosen.reserveIndex, chosen.to);
      } else {
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

// ── Event Listeners ──
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
    resetDanceTracker();
    V.totalMoves = 0; V.currentGameNotation = []; V.gameMovesData = []; V.humanGameFinalized = false;
    V.pendingMove = null;
    aiVsAiBtn.classList.add("active"); aiVsAiBtn.textContent = "⏹ Stop AI vs AI";
    state.message = "🤖 AI vs AI iniciado. Nivel: " + difficultySelect.value;
    render();
    runAiVsAi();
  });
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

export { runAiVsAi, runTrainingGame };