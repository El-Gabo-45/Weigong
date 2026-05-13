// tools/benchmark-suite.js
// ══════════════════════════════════════════════════════════════
//  BENCHMARK SUITE — NPS, nodes, branching, TT hit rate,
// ES: BENCHMARK SUITE — NPS, nodes, branching, TT hit rate,
//  NN latency, move ordering, eval throughput.
// ES: NN latency, move ordering, eval throughput.
// ══════════════════════════════════════════════════════════════

import { state }                  from '../state.js';
import { cloneStateForBot }        from '../state.js';
import { evaluate, computeFullHash, gamePhaseFactor } from '../../engine/ai/index.js';
import { getAllLegalMoves, applyMove, afterMoveEvaluation } from '../../engine/rules/index.js';
import { SIDE }                    from '../../engine/constants.js';

export class BenchmarkSuite {
  constructor(pane) {
    this.pane = pane;
    this.running = false;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <span class="dt-label">Positions</span>
        <input class="dt-input" id="bk-n" type="number" value="200" min="10" max="2000" style="width:65px">
        <button class="dt-btn primary" id="bk-run">▶ Run benchmark</button>
        <button class="dt-btn" id="bk-evalonly">Eval only</button>
        <span id="bk-status" style="color:#3a4560;font-size:10px;margin-left:8px"></span>
      </div>
      <div id="bk-progress" style="margin:6px 0;height:5px;background:#111824;border-radius:999px;overflow:hidden">
        <div id="bk-bar" style="height:100%;width:0%;background:#8ab4ff;border-radius:999px;transition:width .15s"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px">
        <div>
          <div class="dt-section">Evaluation</div>
          <div id="bk-eval-stats"></div>
        </div>
        <div>
          <div class="dt-section">Move generation</div>
          <div id="bk-move-stats"></div>
        </div>
        <div>
          <div class="dt-section">Consistency</div>
          <div id="bk-consist"></div>
        </div>
      </div>
      <div class="dt-section">Eval score distribution</div>
      <div id="bk-dist" style="font-family:monospace;font-size:13px;letter-spacing:2px;margin-top:4px;color:#4a5878"></div>
      <div id="bk-dist-labels" style="display:flex;justify-content:space-between;font-size:9px;color:#2d3860;margin-top:2px"></div>
    `;

    this.pane.querySelector('#bk-run').addEventListener('click', () => this._runFull());
    this.pane.querySelector('#bk-evalonly').addEventListener('click', () => this._runEvalOnly());
  }

  async _buildPositions(n) {
    const positions = [];
    const base = cloneStateForBot(state);
    positions.push({ s: base, h: computeFullHash(base) });
    let cur = base;
    for (let i = 0; i < n - 1 && cur.status === 'playing'; i++) {
      const moves = getAllLegalMoves(cur, cur.turn);
      if (!moves.length) break;
      const m = moves[Math.floor(Math.random() * moves.length)];
      const next = JSON.parse(JSON.stringify({ board: cur.board, turn: cur.turn, reserves: cur.reserves, palaceTaken: cur.palaceTaken, palaceTimers: cur.palaceTimers, palaceCurse: cur.palaceCurse, lastMove: cur.lastMove, status: cur.status, history: [], selected: null, legalMoves: [], message: '' }));
      next.positionHistory = new Map();
      try {
        applyMove(next, m.fromReserve ? m : { from: m.from, to: m.to, promotion: false });
        positions.push({ s: next, h: computeFullHash(next) });
        cur = next;
      } catch { break; }
      if (i % 20 === 0) {
        this.pane.querySelector('#bk-bar').style.width = `${(i / n * 50)}%`;
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return positions;
  }

  async _runEvalOnly() {
    if (this.running) return;
    this.running = true;
    const n = Math.min(parseInt(this.pane.querySelector('#bk-n').value) || 200, 2000);
    const status = this.pane.querySelector('#bk-status');
    status.textContent = 'Building positions…';

    const positions = await this._buildPositions(n);
    this.pane.querySelector('#bk-bar').style.width = '50%';
    status.textContent = 'Benchmarking eval…';

    const times = [], scores = [];
    for (const { s, h } of positions) {
      const t0 = performance.now();
      const res = evaluate(s, h);
      times.push(performance.now() - t0);
      scores.push(res.score);
    }

    this.pane.querySelector('#bk-bar').style.width = '100%';
    this._renderEvalStats(times, scores);
    this._renderDist(scores);
    status.textContent = `Done (${positions.length} positions)`;
    this.running = false;
  }

  async _runFull() {
    if (this.running) return;
    this.running = true;
    const n = Math.min(parseInt(this.pane.querySelector('#bk-n').value) || 200, 2000);
    const status = this.pane.querySelector('#bk-status');
    status.textContent = 'Building positions…';

    const positions = await this._buildPositions(n);
    this.pane.querySelector('#bk-bar').style.width = '40%';

    // Eval benchmark
    // ES: Eval benchmark
    status.textContent = 'Eval benchmark…';
    const evalTimes = [], scores = [];
    for (const { s, h } of positions) {
      const t0 = performance.now();
      const res = evaluate(s, h);
      evalTimes.push(performance.now() - t0);
      scores.push(res.score);
    }
    this.pane.querySelector('#bk-bar').style.width = '60%';

    // Move gen benchmark
    // ES: Move gen benchmark
    status.textContent = 'Move gen benchmark…';
    const moveTimes = [], moveCounts = [];
    for (const { s } of positions.slice(0, Math.min(n, 500))) {
      const t0 = performance.now();
      const moves = getAllLegalMoves(s, s.turn);
      moveTimes.push(performance.now() - t0);
      moveCounts.push(moves.length);
    }
    this.pane.querySelector('#bk-bar').style.width = '80%';

    // Consistency: eval same position 3x, check variance
    // ES: Consistency: eval same position 3x, check variance
    const basePos = positions[0];
    const repeatScores = [];
    for (let i = 0; i < 10; i++) repeatScores.push(evaluate(basePos.s, basePos.h).score);
    const variance = repeatScores.every(s => s === repeatScores[0]) ? 0 : Math.max(...repeatScores) - Math.min(...repeatScores);

    this.pane.querySelector('#bk-bar').style.width = '100%';

    this._renderEvalStats(evalTimes, scores);
    this._renderMoveStats(moveTimes, moveCounts);
    this._renderConsist(variance, repeatScores[0]);
    this._renderDist(scores);
    status.textContent = `Done (${positions.length} positions)`;
    this.running = false;
  }

  _avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
  _min(arr) { return arr.length ? Math.min(...arr) : 0; }
  _max(arr) { return arr.length ? Math.max(...arr) : 0; }

  _renderEvalStats(times, scores) {
    const el = this.pane.querySelector('#bk-eval-stats');
    const avg = this._avg(times);
    const eps = avg > 0 ? Math.round(1000 / avg) : '∞';
    el.innerHTML = `
      <div class="dt-row"><span class="dt-label">Avg time</span><span class="dt-val ${avg < 1 ? 'good' : avg < 5 ? 'warn' : 'bad'}">${avg.toFixed(3)}ms</span></div>
      <div class="dt-row"><span class="dt-label">Min</span><span class="dt-val">${this._min(times).toFixed(3)}ms</span></div>
      <div class="dt-row"><span class="dt-label">Max</span><span class="dt-val">${this._max(times).toFixed(2)}ms</span></div>
      <div class="dt-row"><span class="dt-label">Evals/sec</span><span class="dt-val good">${eps.toLocaleString()}</span></div>
      <div class="dt-row"><span class="dt-label">Positions</span><span class="dt-val">${times.length}</span></div>
    `;
  }

  _renderMoveStats(times, counts) {
    const el = this.pane.querySelector('#bk-move-stats');
    const avgT = this._avg(times), avgC = this._avg(counts);
    el.innerHTML = `
      <div class="dt-row"><span class="dt-label">Avg time</span><span class="dt-val ${avgT < 2 ? 'good' : avgT < 8 ? 'warn' : 'bad'}">${avgT.toFixed(3)}ms</span></div>
      <div class="dt-row"><span class="dt-label">Avg moves</span><span class="dt-val">${avgC.toFixed(1)}</span></div>
      <div class="dt-row"><span class="dt-label">Min moves</span><span class="dt-val">${this._min(counts)}</span></div>
      <div class="dt-row"><span class="dt-label">Max moves</span><span class="dt-val">${this._max(counts)}</span></div>
      <div class="dt-row"><span class="dt-label">MoveGen/s</span><span class="dt-val">${avgT > 0 ? Math.round(1000/avgT).toLocaleString() : '∞'}</span></div>
    `;
  }

  _renderConsist(variance, score) {
    const el = this.pane.querySelector('#bk-consist');
    el.innerHTML = `
      <div class="dt-row"><span class="dt-label">Score</span><span class="dt-val">${score}</span></div>
      <div class="dt-row"><span class="dt-label">Variance</span><span class="dt-val ${variance === 0 ? 'good' : 'bad'}">${variance}</span></div>
      <div class="dt-row"><span class="dt-label">Determinism</span><span class="dt-val ${variance === 0 ? 'good' : 'bad'}">${variance === 0 ? '✓ 100%' : '✗ Flaky'}</span></div>
    `;
  }

  _renderDist(scores) {
    if (!scores.length) return;
    const BUCKETS = 20;
    const min = Math.min(...scores), max = Math.max(...scores), range = max - min || 1;
    const buckets = new Array(BUCKETS).fill(0);
    for (const s of scores) {
      const b = Math.min(BUCKETS - 1, Math.floor((s - min) / range * BUCKETS));
      buckets[b]++;
    }
    const maxB = Math.max(...buckets);
    const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
    this.pane.querySelector('#bk-dist').textContent = buckets.map(b => bars[Math.round(b / maxB * 7)]).join('');
    this.pane.querySelector('#bk-dist-labels').innerHTML = `<span>${min}</span><span>0</span><span>${max}</span>`;
  }

  onShow() {}
}