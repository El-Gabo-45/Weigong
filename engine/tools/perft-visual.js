// tools/perft-visual.js
// ══════════════════════════════════════════════════════════════
//  PERFT VISUAL — Node count per depth with breakdown:
//  captures, promotions, checks, drops, branching per ply.
//  Runs from current position or start position.
// ══════════════════════════════════════════════════════════════

import { state }                    from '../state.js';
import { cloneStateForBot }          from '../state.js';
import { getAllLegalMoves, applyMove, executeDrop, afterMoveEvaluation } from '../../engine/rules/index.js';
import { isKingInCheck }             from '../../engine/rules/index.js';
import { SIDE }                      from '../../engine/constants.js';

export class PerftVisual {
  constructor(pane) {
    this.pane = pane;
    this.running = false;
    this.cancelled = false;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Max depth</span>
        <input class="dt-input" id="pv-depth" type="number" value="3" min="1" max="5" style="width:55px">
        <span class="dt-label" style="margin-left:8px">From</span>
        <select class="dt-select" id="pv-from">
          <option value="current">Current position</option>
          <option value="start">Start position</option>
        </select>
        <button class="dt-btn primary" id="pv-run">▶ Run perft</button>
        <button class="dt-btn danger" id="pv-cancel" style="display:none">■ Stop</button>
      </div>
      <div id="pv-progress" style="margin:6px 0;font-size:10px;color:#3a4560"></div>
      <div id="pv-results"></div>
    `;
    this.pane.querySelector('#pv-run').addEventListener('click', () => this._run());
    this.pane.querySelector('#pv-cancel').addEventListener('click', () => { this.cancelled = true; });
  }

  async _run() {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    const maxDepth = Math.min(parseInt(this.pane.querySelector('#pv-depth').value) || 3, 5);
    const fromStart = this.pane.querySelector('#pv-from').value === 'start';
    const btn = this.pane.querySelector('#pv-run');
    const cancelBtn = this.pane.querySelector('#pv-cancel');
    const progress = this.pane.querySelector('#pv-progress');
    const results = this.pane.querySelector('#pv-results');
    btn.disabled = true; cancelBtn.style.display = '';
    results.innerHTML = '';

    let rootState;
    if (fromStart) {
      const { createGame } = await import('../rules/index.js');
      rootState = createGame();
    } else {
      rootState = cloneStateForBot(state);
    }

    const table = [];
    for (let d = 1; d <= maxDepth && !this.cancelled; d++) {
      progress.textContent = `Running depth ${d}…`;
      await new Promise(r => setTimeout(r, 0));
      const t0 = performance.now();
      const stats = { nodes: 0, captures: 0, promotions: 0, checks: 0, drops: 0 };
      this._perft(rootState, d, stats);
      const ms = (performance.now() - t0).toFixed(1);
      const nps = ms > 0 ? Math.round(stats.nodes / parseFloat(ms) * 1000) : 0;
      table.push({ depth: d, ...stats, ms, nps });
      this._renderTable(table);
    }

    progress.textContent = this.cancelled ? 'Cancelled.' : 'Done.';
    btn.disabled = false; cancelBtn.style.display = 'none';
    this.running = false;
  }

  _cloneForPerft(s) {
    const b = new Array(13);
    for (let r = 0; r < 13; r++) {
      b[r] = new Array(13);
      for (let c = 0; c < 13; c++) { const p = s.board[r][c]; b[r][c] = p ? { ...p } : null; }
    }
    return {
      board: b, turn: s.turn,
      reserves: { white: s.reserves.white.map(p => ({ ...p })), black: s.reserves.black.map(p => ({ ...p })) },
      palaceTaken: { ...s.palaceTaken }, palaceTimers: { white: { ...s.palaceTimers?.white }, black: { ...s.palaceTimers?.black } },
      palaceCurse: s.palaceCurse ? { white: { ...s.palaceCurse.white }, black: { ...s.palaceCurse.black } } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
      lastMove: s.lastMove ? { ...s.lastMove } : null,
      lastRepeatedMoveKey: s.lastRepeatedMoveKey ?? null, repeatMoveCount: s.repeatMoveCount ?? 0,
      positionHistory: new Map(), history: [], status: s.status, selected: null, legalMoves: [], message: '',
    };
  }

  _perft(s, depth, stats) {
    const moves = getAllLegalMoves(s, s.turn);
    if (depth === 1) {
      stats.nodes += moves.length;
      for (const m of moves) {
        if (m.fromReserve) { stats.drops++; continue; }
        const target = s.board[m.to?.r]?.[m.to?.c];
        if (target && target.side !== s.turn) stats.captures++;
        const piece = s.board[m.from?.r]?.[m.from?.c];
        if (piece && m.promotion) stats.promotions++;
      }
      return moves.length;
    }
    let total = 0;
    for (const m of moves) {
      if (this.cancelled) return total;
      const clone = this._cloneForPerft(s);
      try {
        if (m.fromReserve) executeDrop(clone, m.reserveIndex, m.to);
        else applyMove(clone, { from: m.from, to: m.to, promotion: m.promotion ?? false });
        afterMoveEvaluation(clone);
        if (clone.status === 'playing') total += this._perft(clone, depth - 1, stats);
        else { total++; stats.nodes++; }
      } catch { total++; }
    }
    return total;
  }

  _renderTable(table) {
    const el = this.pane.querySelector('#pv-results');
    el.innerHTML = `
      <table class="dt-table" style="margin-top:6px">
        <thead><tr><th>Depth</th><th>Nodes</th><th>NPS</th><th>Captures</th><th>Promotions</th><th>Drops</th><th>Time</th></tr></thead>
        <tbody>
          ${table.map(r => `
            <tr>
              <td>${r.depth}</td>
              <td class="mono" style="color:#8ab4ff">${r.nodes.toLocaleString()}</td>
              <td class="mono">${r.nps.toLocaleString()}</td>
              <td class="mono">${r.captures.toLocaleString()}</td>
              <td class="mono">${r.promotions.toLocaleString()}</td>
              <td class="mono">${r.drops.toLocaleString()}</td>
              <td class="mono">${r.ms}ms</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  onShow() {}
}                                                                          