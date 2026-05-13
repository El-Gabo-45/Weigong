// ══════════════════════════════════════════════════════════════
//  REPLAY ANALYZER — Replay saved games move by move
// ES: REPLAY ANALYZER — Replay saved games move by move
//  ES: Reproductor de partidas guardadas movimiento por movimiento
// ══════════════════════════════════════════════════════════════

import { state } from '../state.js';
import { render } from '../../src/ui/gameplay.js';
import { SIDE, BOARD_SIZE } from '../../engine/constants.js';

export class ReplayAnalyzer {
  constructor(pane) {
    this.pane = pane;
    this.games = [];
    this.currentIdx = -1;
    this.moveIdx = 0;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <label class="dt-btn primary" style="cursor:pointer">
          📂 Load game JSON
          <input id="re-file" type="file" accept=".json" style="display:none">
        </label>
        <button class="dt-btn" id="re-clear">Clear</button>
        <span id="re-status" style="color:#3a4560;font-size:10px;margin-left:6px"></span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 240px;gap:10px;margin-top:8px;height:300px">
        <div style="overflow:auto">
          <div class="dt-section">Game info</div>
          <div id="re-info" style="margin-bottom:8px"></div>
          <div class="dt-section">Controls</div>
          <div id="re-controls" style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap">
            <button class="dt-btn" id="re-first">⏮ First</button>
            <button class="dt-btn" id="re-prev">◀ Prev</button>
            <button class="dt-btn primary" id="re-play">▶ Play</button>
            <button class="dt-btn" id="re-next">Next ▶</button>
            <button class="dt-btn" id="re-last">Last ⏭</button>
          </div>
          <div class="dt-row">
            <span class="dt-label">Move</span>
            <span id="re-move-num" class="dt-val">0 / 0</span>
            <input class="dt-input" id="re-slider" type="range" min="0" max="0" value="0" style="flex:1">
          </div>
        </div>
        <div style="overflow:auto">
          <div class="dt-section">Move list</div>
          <div id="re-movelist" style="font-size:10px;color:#4a5878;line-height:1.6"></div>
        </div>
      </div>
    `;

    this.pane.querySelector('#re-file').addEventListener('change', e => this._loadFile(e.target.files[0]));
    this.pane.querySelector('#re-clear').addEventListener('click', () => this._clear());
    this.pane.querySelector('#re-first').addEventListener('click', () => this._goTo(0));
    this.pane.querySelector('#re-prev').addEventListener('click', () => this._goTo(this.moveIdx - 1));
    this.pane.querySelector('#re-next').addEventListener('click', () => this._goTo(this.moveIdx + 1));
    this.pane.querySelector('#re-last').addEventListener('click', () => this._goTo(this._maxMove()));
    this.pane.querySelector('#re-play').addEventListener('click', () => this._togglePlay());
    this.pane.querySelector('#re-slider').addEventListener('input', e => this._goTo(parseInt(e.target.value)));
  }

  async _loadFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const game = JSON.parse(text);
      this.games = [game];
      this.currentIdx = 0;
      this.moveIdx = 0;
      this._renderInfo();
      this._renderMoveList();
      this._applyMove(0);
      this.pane.querySelector('#re-status').textContent = `Loaded: ${file.name}`;
    } catch (e) {
      this.pane.querySelector('#re-status').textContent = `Error: ${e.message}`;
    }
  }

  _renderInfo() {
    const el = this.pane.querySelector('#re-info');
    const game = this.games[this.currentIdx];
    if (!game) { el.innerHTML = '<span style="color:#2d3860">No game loaded</span>'; return; }
    const moves = game.moves ?? [];
    el.innerHTML = `
      <div class="dt-row"><span class="dt-label">Status</span><span class="dt-val">${game.finalStatus ?? '?'}</span></div>
      <div class="dt-row"><span class="dt-label">Moves</span><span class="dt-val">${moves.length}</span></div>
      <div class="dt-row"><span class="dt-label">Result</span><span class="dt-val ${game.result === 'win' ? 'good' : game.result === 'loss' ? 'bad' : ''}">${game.result ?? '?'}</span></div>
    `;
  }

  _renderMoveList() {
    const el = this.pane.querySelector('#re-movelist');
    const game = this.games[this.currentIdx];
    if (!game) { el.innerHTML = ''; return; }
    const moves = game.moves ?? [];
    el.innerHTML = moves.map((m, i) => {
      const active = i === this.moveIdx ? 'color:#8ab4ff;font-weight:700' : '';
      return `<div style="${active};cursor:pointer" data-idx="${i}">${i + 1}. ${m.notation ?? m.moveKeyStr ?? '?'}</div>`;
    }).join('');

    el.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => this._goTo(parseInt(el.dataset.idx)));
    });
  }

  _applyMove(idx) {
    const game = this.games[this.currentIdx];
    if (!game) return;
    const moves = game.moves ?? [];
    if (idx < 0 || idx >= moves.length) return;

    const snapshot = moves[idx].stateAfter ?? moves[idx].boardSnapshot;
    if (snapshot) {
      // Restore board from snapshot
      // ES: Restore board from snapshot
      if (snapshot.board) {
        for (let r = 0; r < BOARD_SIZE; r++)
          for (let c = 0; c < BOARD_SIZE; c++)
            state.board[r][c] = snapshot.board[r][c] ? { ...snapshot.board[r][c] } : null;
      } else {
        // boardSnapshot format: array of { t, promoted } or null
        // ES: boardSnapshot format: array of { t, promoted } or null
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const s = snapshot[r * BOARD_SIZE + c];
            state.board[r][c] = s ? { id: crypto.randomUUID(), type: s.t?.slice(0, -1) ?? 'pawn', side: s.t?.slice(-1) === 'w' ? SIDE.WHITE : SIDE.BLACK, promoted: s.promoted === 1, locked: false } : null;
          }
        }
      }
      if (snapshot.turn) state.turn = snapshot.turn;
      if (snapshot.reserves) {
        state.reserves.white = snapshot.reserves.white?.map(p => ({ ...p, id: p.id ?? crypto.randomUUID() })) ?? [];
        state.reserves.black = snapshot.reserves.black?.map(p => ({ ...p, id: p.id ?? crypto.randomUUID() })) ?? [];
      }
      if (snapshot.status) state.status = snapshot.status;
      if (snapshot.message) state.message = snapshot.message;
    }

    this.moveIdx = idx;
    const slider = this.pane.querySelector('#re-slider');
    slider.max = String(moves.length - 1);
    slider.value = String(idx);
    this.pane.querySelector('#re-move-num').textContent = `${idx + 1} / ${moves.length}`;
    this._renderMoveList();
    render();
  }

  _goTo(idx) {
    const game = this.games[this.currentIdx];
    if (!game) return;
    const moves = game.moves ?? [];
    this._applyMove(Math.max(0, Math.min(idx, moves.length - 1)));
  }

  _maxMove() {
    const game = this.games[this.currentIdx];
    return game ? (game.moves?.length ?? 0) - 1 : 0;
  }

  _togglePlay() {
    if (this._playInterval) {
      clearInterval(this._playInterval);
      this._playInterval = null;
      this.pane.querySelector('#re-play').textContent = '▶ Play';
      return;
    }
    this.pane.querySelector('#re-play').textContent = '⏸ Pause';
    this._playInterval = setInterval(() => {
      const max = this._maxMove();
      if (this.moveIdx >= max) {
        clearInterval(this._playInterval);
        this._playInterval = null;
        this.pane.querySelector('#re-play').textContent = '▶ Play';
        return;
      }
      this._goTo(this.moveIdx + 1);
    }, 500);
  }

  _clear() {
    if (this._playInterval) { clearInterval(this._playInterval); this._playInterval = null; }
    this.games = [];
    this.currentIdx = -1;
    this.moveIdx = 0;
    this.pane.querySelector('#re-info').innerHTML = '';
    this.pane.querySelector('#re-movelist').innerHTML = '';
    this.pane.querySelector('#re-slider').max = '0';
    this.pane.querySelector('#re-slider').value = '0';
    this.pane.querySelector('#re-move-num').textContent = '0 / 0';
  }

  onShow() {}
}