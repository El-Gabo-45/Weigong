import {
  SIDE, BOARD_SIZE,
} from "../../engine/constants.js";
import {
  state, V,
  analysisPanel, analysisInfo, analysisBarFill, analysisBarFiller, analysisBarLabel,
} from "../../engine/state.js";
import {
  evaluate, computeFullHash,
} from "../../engine/ai/index.js";

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

function formatAdvantage(score) {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return 'n/a';
  }

  const pawns = score / 100;

  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)} pawns ${pawns >= 0 ? '(black)' : '(white)'}`;
}

function clampAnalysisValue(score) {
  if (!Number.isFinite(score)) return 0;

  return Math.max(-1, Math.min(1, score));
}

function formatNNValue(score) {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return 'n/a';
  }

  const sign = score > 0 ? '+' : '';

  return `${sign}${score.toFixed(2)} nn`;
}

function renderAnalysisPanel() {
  if (!analysisPanel) return;
  if (!V.analysisMode) {
    analysisPanel.classList.add('hidden');
    return;
  }
  analysisPanel.classList.remove('hidden');

  try {
    const evalResult = evaluate(state, computeFullHash(state));
    const rawScore = evalResult.score;
    const whiteScore = -rawScore; // positive = white ahead, in centipawns

    const st = state.status;
    const isDraw = st === 'draw' || st === 'stalemate' || st === 'draw_move_limit' || st === 'draw_agreement';
    const isWhiteWin = (st === 'checkmate' || st === 'palacemate') && state.turn === SIDE.BLACK;
    const isBlackWin = (st === 'checkmate' || st === 'palacemate') && state.turn === SIDE.WHITE;

    let whiteHeight;
    let scoreLabel;

    if (isDraw) {
      whiteHeight = 50;
      scoreLabel = '½-½';
    } else if (isWhiteWin) {
      whiteHeight = 100;
      scoreLabel = '1-0';
    } else if (isBlackWin) {
      whiteHeight = 0;
      scoreLabel = '0-1';
    } else {
      const norm = Math.tanh(whiteScore / 8000);
      whiteHeight = Math.max(0, Math.min(100, 50 + norm * 50));
      const pawns = Number.isFinite(whiteScore) ? (whiteScore / 100).toFixed(2) : '--';
      const sign  = whiteScore > 0 ? '+' : '';
      const side  = whiteScore > 50 ? ' W' : whiteScore < -50 ? ' B' : '';
      scoreLabel = `${sign}${pawns}${side}`;
    }

    if (analysisBarFiller) {
      analysisBarFiller.style.height = `${whiteHeight}%`;
    }
    if (analysisBarLabel) {
      analysisBarLabel.style.display = 'none';
    }
    if (analysisInfo) {
      analysisInfo.textContent = scoreLabel;
    }
  } catch (e) { /* silent */ }
}

async function analyzeCurrentPosition() {
  if (!V.analysisMode || V.analysisRunning) return;
  V.analysisRunning = true;
  try {
    const nnEncoding = encodeBoardForNN(state.board);
    const resp = await fetch('/api/nn/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: Array.from(nnEncoding) }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.ok && Number.isFinite(data.score)) {
        V.analysisNNScore = data.score;
        renderAnalysisPanel(); // solo refresca el texto del NN
      }
    }
  } catch (e) {
    console.warn('NN unavailable:', e.message);
  } finally {
    V.analysisRunning = false;
  }
}

export {
  encodeBoardForNN,
  formatAdvantage,
  clampAnalysisValue,
  formatNNValue,
  renderAnalysisPanel,
  analyzeCurrentPosition,
};