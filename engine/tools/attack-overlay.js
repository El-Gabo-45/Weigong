// tools/attack-overlay.js
// ══════════════════════════════════════════════════════════════
//  ATTACK OVERLAY — Visualize attacked squares, control heat,
//  piece influence lines, and tactical threats on the live board.
//
//  How it works: injects a transparent SVG layer over #board.
//  Reads the live game state from state.js and ai/evaluation.js.
// ══════════════════════════════════════════════════════════════

import { state }           from '../state.js';
import { buildAttackMap }  from '../../engine/ai/evaluation.js';
import { SIDE, BOARD_SIZE, isPalaceSquare } from '../../engine/constants.js';
import { evaluate, computeFullHash } from '../../engine/ai/index.js';

const CELL_PX = 58;   // cell width + gap — must match CSS .cell size
const COORD_PX = 26;  // coord column width
const PIECE_TYPES = ['king','queen','general','elephant','priest','horse','cannon','tower','carriage','archer','pawn','crossbow'];

// ── Color palettes ────────────────────────────────────────────
const HEAT = {
  black: (v) => `rgba(192,132,252,${Math.min(.72, v * .28)})`,   // purple
  white: (v) => `rgba(101,211,138,${Math.min(.72, v * .28)})`,   // green
  both:  (v) => `rgba(251,191,36,${Math.min(.72, v * .28)})`,    // yellow (contested)
};

export class AttackOverlay {
  constructor(pane) {
    this.pane = pane;
    this.svg = null;
    this.mode = 'heat';       // heat | piece | threats | lines
    this.side = 'both';       // black | white | both
    this.activePiece = null;  // {r,c} for single-piece mode
    this.visible = false;
    this.overlayEl = null;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Mode</span>
        <select class="dt-select" id="ao-mode">
          <option value="heat">Heat (attack density)</option>
          <option value="piece">Piece influence</option>
          <option value="threats">Threats (hanging pieces)</option>
          <option value="lines">Tactical lines</option>
        </select>
        <span class="dt-label" style="margin-left:8px">Side</span>
        <select class="dt-select" id="ao-side">
          <option value="both">Both</option>
          <option value="black">Black</option>
          <option value="white">White</option>
        </select>
        <button class="dt-btn primary" id="ao-toggle">Show overlay</button>
        <button class="dt-btn" id="ao-refresh">⟳ Refresh</button>
      </div>
      <div class="dt-section">Threat summary</div>
      <div id="ao-summary" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"></div>
      <div class="dt-section">Legend</div>
      <div id="ao-legend" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;"></div>
      <div class="dt-section">Board control</div>
      <div id="ao-control" style=""></div>
    `;

    this.pane.querySelector('#ao-mode').addEventListener('change', e => {
      this.mode = e.target.value; if (this.visible) this.render();
    });
    this.pane.querySelector('#ao-side').addEventListener('change', e => {
      this.side = e.target.value; if (this.visible) this.render();
    });
    this.pane.querySelector('#ao-toggle').addEventListener('click', () => this._toggleOverlay());
    this.pane.querySelector('#ao-refresh').addEventListener('click', () => this.render());
    this._buildLegend();
    this._renderSummary();
    this._renderControlBar();
  }

  _toggleOverlay() {
    this.visible = !this.visible;
    const btn = this.pane.querySelector('#ao-toggle');
    btn.textContent = this.visible ? 'Hide overlay' : 'Show overlay';
    btn.classList.toggle('primary', !this.visible);
    btn.classList.toggle('danger', this.visible);
    if (this.visible) { this._attachSVG(); this.render(); }
    else this._detachSVG();
  }

  _attachSVG() {
    const boardEl = document.getElementById('board');
    if (!boardEl || this.overlayEl) return;
    const wrapper = boardEl.parentElement;
    wrapper.style.position = 'relative';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'ao-svg';
    svg.style.cssText = `
      position:absolute; top:0; left:0; width:100%; height:100%;
      pointer-events:none; z-index:5;
    `;
    wrapper.appendChild(svg);
    this.overlayEl = svg;
  }

  _detachSVG() {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  render() {
    this._renderSummary();
    this._renderControlBar();
    if (!this.visible || !this.overlayEl) return;

    const svg = this.overlayEl;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const bm = buildAttackMap(state.board, SIDE.BLACK);
    const wm = buildAttackMap(state.board, SIDE.WHITE);

    if (this.mode === 'heat')     this._drawHeat(svg, bm, wm);
    if (this.mode === 'piece')    this._drawPieceInfluence(svg, bm, wm);
    if (this.mode === 'threats')  this._drawThreats(svg, bm, wm);
    if (this.mode === 'lines')    this._drawLines(svg, bm, wm);
  }

  _cellXY(r, c) {
    // Board grid starts after coord column
    const x = COORD_PX + c * CELL_PX + 2;
    const y = COORD_PX + r * CELL_PX + 2;
    return { x, y, w: CELL_PX - 2, h: CELL_PX - 2 };
  }

  _drawHeat(svg, bm, wm) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const key = `${r},${c}`;
        const ba = bm.attackMap.get(key) ?? 0;
        const wa = wm.attackMap.get(key) ?? 0;
        if (ba === 0 && wa === 0) continue;

        const { x, y, w, h } = this._cellXY(r, c);
        let fill;
        if (this.side === 'black' || (this.side === 'both' && ba > wa))
          fill = HEAT.black(ba);
        else if (this.side === 'white' || (this.side === 'both' && wa > ba))
          fill = HEAT.white(wa);
        else
          fill = HEAT.both(Math.max(ba, wa));

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', w); rect.setAttribute('height', h);
        rect.setAttribute('rx', 8);
        rect.setAttribute('fill', fill);
        svg.appendChild(rect);

        // Attack count label
        if (ba > 0 || wa > 0) {
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', x + w - 6); label.setAttribute('y', y + 14);
          label.setAttribute('text-anchor', 'end');
          label.setAttribute('font-size', '9');
          label.setAttribute('font-family', 'monospace');
          label.setAttribute('fill', 'rgba(255,255,255,.5)');
          label.textContent = this.side === 'both' ? `${ba}/${wa}` : (this.side === 'black' ? ba : wa);
          svg.appendChild(label);
        }
      }
    }
  }

  _drawPieceInfluence(svg, bm, wm) {
    // Show mobility count per piece position
    const map = this.side === 'black' ? bm : wm;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        if (this.side !== 'both' && p.side !== this.side) continue;
        const key = `${r},${c}`;
        const mob = map.byPiece.get(key) ?? 0;
        if (mob === 0) continue;
        const { x, y, w, h } = this._cellXY(r, c);
        const intensity = Math.min(1, mob / 20);
        const color = p.side === SIDE.BLACK ? `rgba(192,132,252,${intensity * .6})` : `rgba(101,211,138,${intensity * .6})`;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x + w / 2); circle.setAttribute('cy', y + h / 2);
        circle.setAttribute('r', 8 + mob * 1.4);
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', p.side === SIDE.BLACK ? '#c084fc55' : '#65d38a55');
        circle.setAttribute('stroke-width', '1');
        svg.appendChild(circle);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x + w / 2); label.setAttribute('y', y + h / 2 + 4);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('font-family', 'monospace');
        label.setAttribute('fill', 'rgba(255,255,255,.8)');
        label.textContent = mob;
        svg.appendChild(label);
      }
    }
  }

  _drawThreats(svg, bm, wm) {
    // Highlight pieces that are attacked and undefended (hanging)
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        const key = `${r},${c}`;
        const ownMap  = p.side === SIDE.BLACK ? bm : wm;
        const enemyMap = p.side === SIDE.BLACK ? wm : bm;
        const attacks  = enemyMap.attackMap.get(key) ?? 0;
        const defends  = ownMap.attackMap.get(key) ?? 0;
        if (attacks === 0) continue;
        const { x, y, w, h } = this._cellXY(r, c);
        // Hanging = attacked & not defended or attacked more than defended
        const isHanging = defends === 0 || attacks > defends;
        const col = isHanging ? 'rgba(255,118,118,.45)' : 'rgba(251,191,36,.25)';
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', w); rect.setAttribute('height', h);
        rect.setAttribute('rx', 8);
        rect.setAttribute('fill', col);
        rect.setAttribute('stroke', isHanging ? '#ff767680' : '#fbbf2480');
        rect.setAttribute('stroke-width', isHanging ? '2' : '1');
        svg.appendChild(rect);
      }
    }
  }

  _drawLines(svg, bm, wm) {
    // Draw attack lines from pieces to their targets
    const map = this.side === 'black' ? bm : (this.side === 'white' ? wm : null);
    const maps = map ? [{ m: map, side: this.side }] : [{ m: bm, side: 'black' }, { m: wm, side: 'white' }];
    for (const { m, side } of maps) {
      const color = side === 'black' ? '#c084fc' : '#65d38a';
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = state.board[r][c];
          if (!p || p.side !== side) continue;
          const key = `${r},${c}`;
          const mob = m.byPiece.get(key) ?? 0;
          if (mob === 0) continue;
          // Draw lines to all attacked squares with enemy pieces
          for (const [k] of m.attackMap) {
            const [tr, tc] = k.split(',').map(Number);
            const target = state.board[tr]?.[tc];
            if (!target || target.side === p.side) continue;
            const from = this._cellXY(r, c);
            const to   = this._cellXY(tr, tc);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', from.x + from.w / 2);
            line.setAttribute('y1', from.y + from.h / 2);
            line.setAttribute('x2', to.x + to.w / 2);
            line.setAttribute('y2', to.y + to.h / 2);
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', '1.5');
            line.setAttribute('stroke-opacity', '.4');
            line.setAttribute('stroke-dasharray', '4 3');
            svg.appendChild(line);
          }
        }
      }
    }
  }

  _renderSummary() {
    const el = this.pane.querySelector('#ao-summary');
    if (!el) return;
    const bm = buildAttackMap(state.board, SIDE.BLACK);
    const wm = buildAttackMap(state.board, SIDE.WHITE);

    let blackHanging = 0, whiteHanging = 0, contested = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const key = `${r},${c}`;
        const ba = bm.attackMap.get(key) ?? 0;
        const wa = wm.attackMap.get(key) ?? 0;
        if (ba > 0 && wa > 0) contested++;
        const p = state.board[r][c];
        if (p) {
          const attacks = p.side === SIDE.BLACK ? wm.attackMap.get(key) ?? 0 : bm.attackMap.get(key) ?? 0;
          const defends = p.side === SIDE.BLACK ? bm.attackMap.get(key) ?? 0 : wm.attackMap.get(key) ?? 0;
          if (attacks > 0 && defends === 0) {
            if (p.side === SIDE.BLACK) blackHanging++;
            else whiteHanging++;
          }
        }
      }
    }

    const hash = computeFullHash(state);
    const ev = evaluate(state, hash);
    const score = ev.score;
    const scoreColor = score > 50 ? '#65d38a' : score < -50 ? '#ff7676' : '#fbbf24';

    el.innerHTML = `
      <div class="dt-row" style="flex-direction:column;align-items:start;gap:4px">
        <div class="dt-row"><span class="dt-label">Black mob.</span><span class="dt-val">${bm.mobilityCount.total}</span></div>
        <div class="dt-row"><span class="dt-label">White mob.</span><span class="dt-val">${wm.mobilityCount.total}</span></div>
        <div class="dt-row"><span class="dt-label">Contested sq.</span><span class="dt-val">${contested}</span></div>
      </div>
      <div class="dt-row" style="flex-direction:column;align-items:start;gap:4px">
        <div class="dt-row"><span class="dt-label">Eval</span><span class="dt-val" style="color:${scoreColor}">${score > 0 ? '+' : ''}${score}</span></div>
        <div class="dt-row"><span class="dt-label">⚠ Black hang.</span><span class="dt-val ${blackHanging > 0 ? 'bad' : ''}">${blackHanging}</span></div>
        <div class="dt-row"><span class="dt-label">⚠ White hang.</span><span class="dt-val ${whiteHanging > 0 ? 'bad' : ''}">${whiteHanging}</span></div>
      </div>
    `;
  }

  _renderControlBar() {
    const el = this.pane.querySelector('#ao-control');
    if (!el) return;
    const bm = buildAttackMap(state.board, SIDE.BLACK);
    const wm = buildAttackMap(state.board, SIDE.WHITE);
    let bTotal = 0, wTotal = 0;
    for (const [, v] of bm.attackMap) bTotal += v;
    for (const [, v] of wm.attackMap) wTotal += v;
    const total = bTotal + wTotal || 1;
    const bPct = Math.round(bTotal / total * 100);
    const wPct = 100 - bPct;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <span style="color:#c084fc;font-size:10px;font-weight:700;min-width:42px">B ${bPct}%</span>
        <div style="flex:1;height:8px;background:#111824;border-radius:999px;overflow:hidden;display:flex">
          <div style="width:${bPct}%;background:#c084fc;transition:width .4s"></div>
          <div style="width:${wPct}%;background:#65d38a;transition:width .4s"></div>
        </div>
        <span style="color:#65d38a;font-size:10px;font-weight:700;min-width:42px;text-align:right">W ${wPct}%</span>
      </div>
      <div style="display:flex;gap:18px;margin-top:8px;font-size:10px;color:#3a4560">
        <span>Black attacks: <b style="color:#8a9bc0">${bTotal}</b></span>
        <span>White attacks: <b style="color:#8a9bc0">${wTotal}</b></span>
      </div>
    `;
  }

  _buildLegend() {
    const el = this.pane.querySelector('#ao-legend');
    if (!el) return;
    const items = [
      { color: '#c084fc55', label: 'Black control' },
      { color: '#65d38a55', label: 'White control' },
      { color: '#fbbf2455', label: 'Contested' },
      { color: '#ff767680', label: 'Hanging piece' },
    ];
    el.innerHTML = items.map(i => `
      <div style="display:flex;align-items:center;gap:5px">
        <div style="width:14px;height:14px;border-radius:3px;background:${i.color};border:1px solid ${i.color}"></div>
        <span style="color:#4a5878;font-size:10px">${i.label}</span>
      </div>
    `).join('');
  }

  onShow() {
    this._renderSummary();
    this._renderControlBar();
    if (this.visible) this.render();
  }
}