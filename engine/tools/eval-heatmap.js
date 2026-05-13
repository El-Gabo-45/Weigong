// tools/eval-heatmap.js
// ══════════════════════════════════════════════════════════════
//  EVAL HEATMAP — per-square contribution to the static eval.
// ES: EVAL HEATMAP — per-square contribution to the static eval.
//  Shows piece value + PST bonus per square as a colored grid,
// ES: Shows piece value + PST bonus per square as a colored grid,
//  and a breakdown of each eval term (material, king safety, etc.)
// ES: and a breakdown of each eval term (material, king safety, etc.)
// ══════════════════════════════════════════════════════════════

import { state }           from '../state.js';
import { evaluate, computeFullHash, gamePhaseFactor } from '../../engine/ai/index.js';
import { buildAttackMap }  from '../../engine/ai/evaluation.js';
import { pieceSquareBonus } from '../../engine/ai/moves.js';
import { SIDE, BOARD_SIZE, isPalaceSquare } from '../../engine/constants.js';

const COLS_LBL = 'ABCDEFGHIJKLM';

export class EvalHeatmap {
  constructor(pane) {
    this.pane = pane;
    this.layer = 'total';   // total | material | psbonus | mobility | kingsafety
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Layer</span>
        <select class="dt-select" id="eh-layer">
          <option value="total">Total piece contribution</option>
          <option value="material">Material value only</option>
          <option value="psbonus">Piece-square bonus</option>
          <option value="mobility">Mobility (attack count)</option>
          <option value="hanging">Hanging penalty</option>
        </select>
        <button class="dt-btn primary" id="eh-render">Render</button>
      </div>
      <div id="eh-grid" style="margin-top:8px;overflow-x:auto"></div>
      <div class="dt-section">Eval breakdown</div>
      <div id="eh-breakdown"></div>
    `;
    this.pane.querySelector('#eh-render').addEventListener('click', () => this._render());
    this.pane.querySelector('#eh-layer').addEventListener('change', e => { this.layer = e.target.value; this._render(); });
    this._render();
  }

  _render() {
    this.layer = this.pane.querySelector('#eh-layer').value;
    const hash = computeFullHash(state);
    const ev   = evaluate(state, hash);
    const bm   = buildAttackMap(state.board, SIDE.BLACK);
    const wm   = buildAttackMap(state.board, SIDE.WHITE);

    this._renderGrid(bm, wm);
    this._renderBreakdown(ev, bm, wm);
  }

  _squareScore(r, c, bm, wm) {
    const p = state.board[r][c];
    if (!p) return 0;
    const sign = p.side === SIDE.BLACK ? 1 : -1;
    const key = `${r},${c}`;
    switch (this.layer) {
      case 'material': {
        const VALS = { king:0,queen:950,general:560,elephant:240,priest:400,horse:320,cannon:450,tower:520,carriage:390,archer:450,pawn:110,crossbow:240 };
        const PVALS = { pawn:240,tower:650,horse:430,elephant:320,priest:540,cannon:540 };
        const v = p.promoted ? (PVALS[p.type] ?? (VALS[p.type] ?? 0) + 120) : (VALS[p.type] ?? 0);
        return v * sign;
      }
      case 'psbonus':
        return pieceSquareBonus(p, r, c) * sign;
      case 'mobility': {
        const ownMap = p.side === SIDE.BLACK ? bm : wm;
        return (ownMap.byPiece.get(key) ?? 0) * sign;
      }
      case 'hanging': {
        const enemyMap = p.side === SIDE.BLACK ? wm : bm;
        const attacks  = enemyMap.attackMap.get(key) ?? 0;
        const VALS2 = { king:0,queen:950,general:560,elephant:240,priest:400,horse:320,cannon:450,tower:520,carriage:390,archer:450,pawn:110,crossbow:240 };
        const PVALS2 = { pawn:240,tower:650,horse:430,elephant:320,priest:540,cannon:540 };
        const v = p.promoted ? (PVALS2[p.type] ?? (VALS2[p.type] ?? 0) + 120) : (VALS2[p.type] ?? 0);
        return attacks > 0 ? -(v * 0.42 * attacks * sign) : 0;
      }
      default: {
        const VALS3 = { king:0,queen:950,general:560,elephant:240,priest:400,horse:320,cannon:450,tower:520,carriage:390,archer:450,pawn:110,crossbow:240 };
        const PVALS3 = { pawn:240,tower:650,horse:430,elephant:320,priest:540,cannon:540 };
        const v = p.promoted ? (PVALS3[p.type] ?? (VALS3[p.type] ?? 0) + 120) : (VALS3[p.type] ?? 0);
        return (v + pieceSquareBonus(p, r, c)) * sign;
      }
    }
  }

  _renderGrid(bm, wm) {
    const el = this.pane.querySelector('#eh-grid');
    const scores = [];
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++)
        scores.push(this._squareScore(r, c, bm, wm));

    const maxAbs = Math.max(...scores.map(Math.abs), 1);
    const CELL = 28;
    let html = `<div style="display:inline-block;padding:4px;background:#0b0e14;border-radius:8px">`;

    // Col headers
    // ES: Col headers
    html += `<div style="display:flex;margin-left:${CELL + 2}px;margin-bottom:2px">`;
    for (let c = 0; c < BOARD_SIZE; c++)
      html += `<div style="width:${CELL}px;text-align:center;font-size:8px;color:#2d3860">${COLS_LBL[c]}</div>`;
    html += '</div>';

    for (let r = 0; r < BOARD_SIZE; r++) {
      html += `<div style="display:flex;align-items:center;margin-bottom:1px">`;
      html += `<div style="width:${CELL}px;font-size:8px;color:#2d3860;text-align:center">${13 - r}</div>`;
      for (let c = 0; c < BOARD_SIZE; c++) {
        const s = scores[r * BOARD_SIZE + c];
        const p = state.board[r][c];
        const t = Math.min(1, Math.abs(s) / maxAbs);
        let bg;
        if (s > 0)      bg = `rgba(192,132,252,${t * .75})`;   // black piece: purple
        else if (s < 0) bg = `rgba(101,211,138,${t * .75})`;   // white piece: green
        else            bg = '#111824';

        const isRiver = r === 6;
        const isPalB  = isPalaceSquare(r, c, SIDE.BLACK);
        const isPalW  = isPalaceSquare(r, c, SIDE.WHITE);
        const border  = isRiver ? '1px solid #2d6cdf55' : isPalB || isPalW ? '1px solid #866c3755' : '1px solid #0d1017';

        const label = p ? `<span style="font-size:7px;color:rgba(255,255,255,.6);pointer-events:none">${Math.abs(Math.round(s))}</span>` : '';
        html += `<div title="${p ? p.type + ' (' + p.side + ') ' + Math.round(s) : r + ',' + c}" style="width:${CELL}px;height:${CELL}px;background:${bg};border:${border};border-radius:3px;display:grid;place-items:center;cursor:default;transition:background .2s">${label}</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  _renderBreakdown(ev, bm, wm) {
    const el = this.pane.querySelector('#eh-breakdown');
    const m = ev.metrics;
    const score = ev.score;
    const phase = gamePhaseFactor(state.board);

    const rows = [
      ['Total score', score, score > 0 ? 'good' : score < 0 ? 'bad' : ''],
      ['Game phase',  `${(phase * 100).toFixed(0)}%`, ''],
      ['Palace pressure', `B${(m.palacePressure * 100).toFixed(0)}% W${((1-m.palacePressure)*100).toFixed(0)}%`, ''],
      ['Material balance', `${(m.materialBalance * 100).toFixed(0)}%`, m.materialBalance > 0.5 ? 'good' : 'bad'],
      ['Piece activity',   `${(m.pieceActivity   * 100).toFixed(0)}%`, m.pieceActivity   > 0.5 ? 'good' : 'bad'],
      ['King safety',      `${(m.kingSafety      * 100).toFixed(0)}%`, m.kingSafety      > 0.5 ? 'good' : 'bad'],
      ['Center control',   `${(m.centerControl   * 100).toFixed(0)}%`, m.centerControl   > 0.5 ? 'good' : 'bad'],
    ];

    el.innerHTML = rows.map(([label, val, cls]) => `
      <div class="dt-row">
        <span class="dt-label">${label}</span>
        <span class="dt-val ${cls}">${val}</span>
      </div>
    `).join('');
  }

  onShow() { this._render(); }
}