// ══════════════════════════════════════════════════════════════
//  NN INSPECTOR — Inspect neural network model & predictions
//  ES: Inspector de red neuronal - modelo y predicciones
// ══════════════════════════════════════════════════════════════

import { state } from '../state.js';
import { SIDE, BOARD_SIZE } from '../constants.js';

const PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
};
const NN_CHANNELS = 24;

function encodeBoardForNN(board) {
  const enc = new Float32Array(BOARD_SIZE * BOARD_SIZE * NN_CHANNELS);
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

export class NNInspector {
  constructor(pane) {
    this.pane = pane;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Status</span>
        <span id="nn-status" class="dt-val">Model not loaded (run server)</span>
      </div>
      <div class="dt-row">
        <button class="dt-btn primary" id="nn-predict">▶ Predict current position</button>
      </div>
      <div class="dt-section">Board encoding</div>
      <div id="nn-encoding" style="font-size:9px;color:#3a4560;word-break:break-all;margin-top:4px;max-height:120px;overflow:auto"></div>
      <div class="dt-section">Prediction result</div>
      <div id="nn-result" style="margin-top:4px"></div>
    `;

    this.pane.querySelector('#nn-predict').addEventListener('click', () => this._predict());
  }

  async _predict() {
    const enc = encodeBoardForNN(state.board);
    const el = this.pane.querySelector('#nn-encoding');
    const resultEl = this.pane.querySelector('#nn-result');
    const statusEl = this.pane.querySelector('#nn-status');

    // Show encoding stats
    const nonZero = Array.from(enc).filter(v => v > 0).length;
    el.textContent = `Board encoding: ${enc.length} floats (${nonZero} non-zero)`;

    // Try to call the server NN endpoint
    statusEl.textContent = 'Predicting…';
    resultEl.innerHTML = '<span style="color:#3a4560">Waiting for server…</span>';

    try {
      const resp = await fetch('/api/nn/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: Array.from(enc) }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const score = data.score ?? data.prediction ?? '?';
      const scoreColor = score > 0.1 ? '#65d38a' : score < -0.1 ? '#ff7676' : '#fbbf24';
      resultEl.innerHTML = `
        <div class="dt-row"><span class="dt-label">Score</span><span class="dt-val" style="color:${scoreColor};font-size:16px;font-weight:700">${typeof score === 'number' ? score.toFixed(4) : score}</span></div>
        <div class="dt-row"><span class="dt-label">Model</span><span class="dt-val">${data.model ?? 'default'}</span></div>
      `;
      statusEl.textContent = 'Prediction complete';
    } catch (e) {
      resultEl.innerHTML = `<span style="color:#ff7676">Server unavailable: ${e.message}</span>`;
      statusEl.textContent = 'Server offline';
    }
  }

  onShow() {}
}