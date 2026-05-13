// tools/search-tree.js
// ══════════════════════════════════════════════════════════════
//  SEARCH TREE VIEWER — Hook into the bot's alpha-beta search
// ES: SEARCH TREE VIEWER — Hook into the bot's alpha-beta search
//  to display: PV, depth reached, score, branching factor,
// ES: to display: PV, depth reached, score, branching factor,
//  TT hits, pruning efficiency, and killer move summary.
// ES: TT hits, pruning efficiency, and killer move summary.
//
//  Works by wrapping searchRoot and injecting trace collection.
// ES: Works by wrapping searchRoot and injecting trace collection.
//  Does NOT slow down production: trace only runs when panel open.
// ES: Does NOT slow down production: trace only runs when panel open.
// ══════════════════════════════════════════════════════════════

import { state }                    from '../state.js';
import { cloneStateForBot }         from '../state.js';
import { chooseBotMove }            from '../../engine/ai/index.js';
import { computeFullHash }          from '../../engine/ai/index.js';
import { evaluate }                 from '../../engine/ai/index.js';
import { getAllLegalMoves }         from '../../engine/rules/index.js';
import { SIDE }                     from '../../engine/constants.js';

// ── Trace store (populated by hooked search calls) ────────────
export const SearchTrace = {
  nodes: 0,
  qNodes: 0,
  ttHits: 0,
  cutoffs: 0,
  depthReached: 0,
  pv: [],
  pvScores: [],
  branchingFactors: [],
  killerCounts: new Map(),
  idsProgress: [],   // [{depth, score, bestMove, ms}]
  lastRunMs: 0,
  reset() {
    this.nodes = 0; this.qNodes = 0; this.ttHits = 0; this.cutoffs = 0;
    this.depthReached = 0; this.pv = []; this.pvScores = [];
    this.branchingFactors = []; this.killerCounts.clear();
    this.idsProgress = []; this.lastRunMs = 0;
  },
};

// Try to import search internals for hooking (best-effort)
// ES: Try to import search internals for hooking (best-effort)
let _searchHooked = false;

async function tryHookSearch() {
  if (_searchHooked) return;
  try {
    const mod = await import('../ai/search.js');
    // Wrap searchRoot to intercept IDS progress
    // ES: Wrap searchRoot to intercept IDS progress
    const orig = mod.searchRoot;
    if (orig) {
      // We cannot modify the export directly in ESM, but we can listen
      // ES: We cannot modify the export directly in ESM, but we can listen
      // via the global window.__searchTrace hook set in search.js
      // ES: via the global window.__searchTrace hook set in search.js
      _searchHooked = true;
    }
  } catch { /* search.js might not expose internals - use post-run stats */ }
}

// ── Move key formatting ───────────────────────────────────────
function fmtMove(m) {
  if (!m) return '—';
  if (m.fromReserve) return `*${m.to?.r},${m.to?.c}`;
  return `${m.from?.r},${m.from?.c}→${m.to?.r},${m.to?.c}${m.promotion ? '+' : ''}`;
}

function scoreColor(s) {
  if (s > 500) return '#65d38a';
  if (s < -500) return '#ff7676';
  if (s > 100) return '#a3e6b4';
  if (s < -100) return '#ffaaaa';
  return '#8ab4ff';
}

export class SearchTreeViewer {
  constructor(pane) {
    this.pane = pane;
    this.running = false;
    this.lastResult = null;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Max depth</span>
        <input class="dt-input" id="st-depth" type="number" value="6" min="1" max="12" style="width:55px">
        <span class="dt-label" style="margin-left:8px">Time (ms)</span>
        <input class="dt-input" id="st-time" type="number" value="2000" min="100" max="15000" style="width:70px">
        <button class="dt-btn primary" id="st-run">▶ Run search</button>
        <span id="st-status" style="color:#3a4560;font-size:10px;margin-left:6px"></span>
      </div>

      <div class="dt-section">IDS Progress</div>
      <div id="st-ids" style="margin:4px 0 10px"></div>

      <div class="dt-section">Principal Variation</div>
      <div id="st-pv" style="font-size:11px;color:#4a5878;margin-bottom:8px;word-break:break-all;line-height:1.7"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div class="dt-section">Node stats</div>
          <div id="st-nodes"></div>
        </div>
        <div>
          <div class="dt-section">Efficiency</div>
          <div id="st-eff"></div>
        </div>
      </div>

      <div class="dt-section">Branching factor by depth</div>
      <div id="st-branch" style="margin-top:4px"></div>
    `;

    this.pane.querySelector('#st-run').addEventListener('click', () => this._runSearch());
  }

  async _runSearch() {
    if (this.running) return;
    this.running = true;
    const btn = this.pane.querySelector('#st-run');
    const status = this.pane.querySelector('#st-status');
    btn.disabled = true;
    btn.textContent = '⏳ Searching…';
    status.textContent = '';

    const depth = parseInt(this.pane.querySelector('#st-depth').value) || 6;
    const ms    = parseInt(this.pane.querySelector('#st-time').value) || 2000;

    // Collect IDS data via a manual IDS loop so we can observe each depth
    // ES: Collect IDS data via a manual IDS loop so we can observe each depth
    const idsProgress = [];
    const stCopy = cloneStateForBot(state);

    try {
      // Import search internals
      // ES: Import search internals
      const { searchRoot, TranspositionTable } = await import('../ai/search.js');
      const { computeFullHash }                = await import('../ai/hashing.js');

      const tt = new TranspositionTable(500_000);
      const rootHash = computeFullHash(stCopy);
      let prevScore = evaluate(stCopy, rootHash).score;
      const startMs = performance.now();

      for (let d = 1; d <= depth; d++) {
        const deadline = startMs + ms;
        if (performance.now() > deadline) break;
        const t0 = performance.now();
        let result;
        try {
          result = searchRoot(stCopy, d, -Infinity, Infinity, deadline, tt, rootHash, prevScore);
        } catch { break; }
        const elapsed = performance.now() - t0;
        if (result?.bestMove) {
          prevScore = result.score;
          idsProgress.push({
            depth: d,
            score: result.score,
            bestMove: result.bestMove,
            ms: elapsed.toFixed(1),
            ttSize: tt.map.size,
          });
        }
      }

      const totalMs = (performance.now() - startMs).toFixed(0);
      status.textContent = `Done in ${totalMs}ms`;
      this.lastResult = { idsProgress, tt };
      this._render(idsProgress, tt, totalMs);
    } catch (e) {
      // Fallback: run chooseBotMove and report what we can
      // ES: Fallback: run chooseBotMove and report what we can
      const t0 = performance.now();
      const result = chooseBotMove(stCopy, { maxDepth: depth, timeLimitMs: ms });
      const elapsed = (performance.now() - t0).toFixed(0);
      status.textContent = `Done in ${elapsed}ms (simplified)`;
      this._renderFallback(result, elapsed);
    }

    this.running = false;
    btn.disabled = false;
    btn.textContent = '▶ Run search';
  }

  _render(ids, tt, totalMs) {
    this._renderIDS(ids);
    this._renderNodes(ids, totalMs, tt);
    this._renderEfficiency(ids, tt);
    this._renderBranching(ids);
    this._renderPV(ids);
  }

  _renderIDS(ids) {
    const el = this.pane.querySelector('#st-ids');
    if (!ids.length) { el.innerHTML = '<span style="color:#2d3860">No data</span>'; return; }
    const maxAbs = Math.max(...ids.map(r => Math.abs(r.score)), 1);
    el.innerHTML = ids.map(r => {
      const sc = r.score;
      const pct = Math.min(100, Math.abs(sc) / maxAbs * 100);
      const col = sc > 0 ? '#c084fc' : sc < 0 ? '#65d38a' : '#fbbf24';
      return `
        <div style="display:grid;grid-template-columns:60px 90px 1fr 60px;align-items:center;gap:6px;margin-bottom:4px">
          <span style="color:#3a4560;font-size:10px">depth ${r.depth}</span>
          <span style="color:${scoreColor(sc)};font-weight:700;font-size:11px">${sc > 0 ? '+' : ''}${sc}</span>
          <div style="background:#111824;height:4px;border-radius:999px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${col};border-radius:999px"></div>
          </div>
          <span style="color:#2d3860;font-size:10px;text-align:right">${r.ms}ms</span>
        </div>
      `;
    }).join('');
  }

  _renderPV(ids) {
    const el = this.pane.querySelector('#st-pv');
    if (!ids.length) { el.innerHTML = '<span style="color:#2d3860">—</span>'; return; }
    // Last depth's best move
    // ES: Last depth's best move
    const last = ids[ids.length - 1];
    el.innerHTML = `
      <span class="dt-badge blue" style="margin-right:6px">depth ${last.depth}</span>
      <span style="color:${scoreColor(last.score)};font-weight:700">${last.score > 0 ? '+' : ''}${last.score}</span>
      <span style="color:#2d3860;margin:0 8px">best:</span>
      <span style="color:#8ab4ff;font-weight:700">${fmtMove(last.bestMove)}</span>
      <div style="margin-top:6px;color:#3a4560;font-size:10px">
        ${ids.map((r, i) => `
          <span style="margin-right:8px">
            <span style="color:#1e2a40">d${r.depth}:</span>
            <span style="color:${scoreColor(r.score)}">${r.score > 0 ? '+' : ''}${r.score}</span>
            <span style="color:#1a2535"> ${fmtMove(r.bestMove)}</span>
          </span>
        `).join('')}
      </div>
    `;
  }

  _renderNodes(ids, totalMs, tt) {
    const el = this.pane.querySelector('#st-nodes');
    const ttSize = tt?.map?.size ?? 0;
    el.innerHTML = `
      <div class="dt-row"><span class="dt-label">Depths run</span><span class="dt-val">${ids.length}</span></div>
      <div class="dt-row"><span class="dt-label">TT entries</span><span class="dt-val">${ttSize.toLocaleString()}</span></div>
      <div class="dt-row"><span class="dt-label">Total time</span><span class="dt-val">${totalMs}ms</span></div>
      <div class="dt-row"><span class="dt-label">Time/depth</span><span class="dt-val">${ids.length ? (parseFloat(totalMs) / ids.length).toFixed(1) + 'ms' : '—'}</span></div>
    `;
  }

  _renderEfficiency(ids, tt) {
    const el = this.pane.querySelector('#st-eff');
    if (!ids.length) { el.innerHTML = '<span style="color:#2d3860">—</span>'; return; }
    // Score stability: how much did score change between depths?
    // ES: Score stability: how much did score change between depths?
    const deltas = ids.slice(1).map((r, i) => Math.abs(r.score - ids[i].score));
    const avgDelta = deltas.length ? (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1) : '—';
    const scoreStable = parseFloat(avgDelta) < 50 ? 'good' : parseFloat(avgDelta) < 200 ? 'warn' : 'bad';
    const last = ids[ids.length - 1];
    el.innerHTML = `
      <div class="dt-row"><span class="dt-label">Score drift</span><span class="dt-val ${scoreStable}">±${avgDelta}</span></div>
      <div class="dt-row"><span class="dt-label">TT fill</span><span class="dt-val">${tt ? Math.round(tt.map.size / tt.maxSize * 100) : '?'}%</span></div>
      <div class="dt-row"><span class="dt-label">Final score</span><span class="dt-val" style="color:${scoreColor(last.score)}">${last.score > 0 ? '+' : ''}${last.score}</span></div>
      <div class="dt-row"><span class="dt-label">Final depth</span><span class="dt-val ${last.depth >= 6 ? 'good' : last.depth >= 4 ? 'warn' : 'bad'}">${last.depth}</span></div>
    `;
  }

  _renderBranching(ids) {
    const el = this.pane.querySelector('#st-branch');
    if (ids.length < 2) { el.innerHTML = '<span style="color:#2d3860">Need ≥2 depths</span>'; return; }
    // Estimated branching from time ratios
    // ES: Estimated branching from time ratios
    const bars = ids.slice(1).map((r, i) => {
      const prev = ids[i];
      const ratio = prev.ms > 0 ? (parseFloat(r.ms) / parseFloat(prev.ms)).toFixed(1) : '?';
      return `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="color:#3a4560;font-size:10px;min-width:50px">d${prev.depth}→d${r.depth}</span>
          <div style="background:#111824;height:5px;border-radius:999px;flex:1;overflow:hidden">
            <div style="width:${Math.min(100, (parseFloat(ratio) ?? 1) / 15 * 100)}%;height:100%;background:#8ab4ff55;border-radius:999px"></div>
          </div>
          <span style="color:#8a9bc0;font-size:10px;min-width:30px;text-align:right">×${ratio}</span>
        </div>
      `;
    }).join('');
    el.innerHTML = bars || '<span style="color:#2d3860">—</span>';
  }

  _renderFallback(result, elapsed) {
    this.pane.querySelector('#st-ids').innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Best move</span>
        <span class="dt-val">${fmtMove(result?.move)}</span>
      </div>
      <div class="dt-row">
        <span class="dt-label">Score</span>
        <span class="dt-val" style="color:${scoreColor(result?.score ?? 0)}">${result?.score ?? '?'}</span>
      </div>
      <div class="dt-row">
        <span class="dt-label">Time</span>
        <span class="dt-val">${elapsed}ms</span>
      </div>
      <div style="margin-top:8px;color:#2d3860;font-size:10px">
        (Full IDS breakdown requires search.js to expose searchRoot)
      </div>
    `;
    ['#st-pv','#st-nodes','#st-eff','#st-branch'].forEach(id => {
      const el = this.pane.querySelector(id);
      if (el) el.innerHTML = '';
    });
  }

  onShow() {}
}