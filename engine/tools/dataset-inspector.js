// tools/dataset-inspector.js
// ══════════════════════════════════════════════════════════════
//  DATASET INSPECTOR — Open selfplay game JSON files and inspect:
//  features, NN encoding, eval targets, position quality,
//  corrupt/degenerate samples, and training data stats.
// ══════════════════════════════════════════════════════════════

export class DatasetInspector {
  constructor(pane) {
    this.pane = pane;
    this.games = [];
    this.selected = null;
    this._build();
  }

  _build() {
    this.pane.innerHTML = `
      <div class="dt-row">
        <label class="dt-btn primary" style="cursor:pointer">
          📂 Load game(s) JSON
          <input id="di-file" type="file" accept=".json" multiple style="display:none">
        </label>
        <button class="dt-btn" id="di-clear">Clear</button>
        <span id="di-status" style="color:#3a4560;font-size:10px;margin-left:6px"></span>
      </div>

      <div style="display:grid;grid-template-columns:240px 1fr;gap:10px;margin-top:8px;height:320px">
        <div style="display:flex;flex-direction:column;gap:4px">
          <div style="color:#2d3860;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Files</div>
          <div id="di-list" style="overflow-y:auto;flex:1;border:1px solid #1e2535;border-radius:6px;padding:4px"></div>
        </div>
        <div style="overflow:auto">
          <div id="di-detail" style="font-size:11px"></div>
        </div>
      </div>
    `;

    this.pane.querySelector('#di-file').addEventListener('change', e => this._loadFiles(e.target.files));
    this.pane.querySelector('#di-clear').addEventListener('click', () => this._clear());
  }

  async _loadFiles(files) {
    const status = this.pane.querySelector('#di-status');
    for (const file of files) {
      try {
        const text = await file.text();
        const obj  = JSON.parse(text);
        const game = this._parseGame(obj, file.name);
        this.games.push(game);
        status.textContent = `Loaded ${this.games.length} file(s)`;
      } catch (e) {
        status.textContent = `Error: ${e.message}`;
      }
    }
    this._renderList();
  }

  _parseGame(obj, name) {
    const moves = obj.moves ?? [];
    const status = obj.finalStatus ?? obj.status ?? '?';
    const samples = moves.filter(m => m._nnFloat32 || m.featureKey).length;
    const evalRange = moves.length > 0 ? {
      min: Math.min(...moves.map(m => m.evalAfter ?? 0)),
      max: Math.max(...moves.map(m => m.evalAfter ?? 0)),
    } : { min: 0, max: 0 };

    // Detect issues
    const issues = [];
    if (moves.length === 0) issues.push('empty game');
    if (moves.length < 4)   issues.push('very short');
    if (status === 'stalemate' && moves.length < 10) issues.push('early stalemate');
    const hasNaN = moves.some(m => isNaN(m.evalAfter) || isNaN(m.evalBefore));
    if (hasNaN) issues.push('NaN eval scores');
    const nnMissing = moves.filter(m => !m._nnFloat32 && !m.boardSnapshot).length;
    if (nnMissing > moves.length * 0.5) issues.push('NN encoding missing');
    const dupPositions = this._countDuplicatePositions(moves);
    if (dupPositions > moves.length * 0.3) issues.push(`${dupPositions} repeated positions`);

    return { name, obj, moves, status, samples, evalRange, issues, dupPositions };
  }

  _countDuplicatePositions(moves) {
    const seen = new Set();
    let dups = 0;
    for (const m of moves) {
      if (!m.positionHash) continue;
      if (seen.has(m.positionHash)) dups++;
      seen.add(m.positionHash);
    }
    return dups;
  }

  _renderList() {
    const el = this.pane.querySelector('#di-list');
    el.innerHTML = this.games.map((g, i) => {
      const hasIssues = g.issues.length > 0;
      return `
        <div data-idx="${i}" style="
          padding:5px 8px;border-radius:5px;cursor:pointer;margin-bottom:3px;
          background:${this.selected === i ? 'rgba(138,180,255,.08)' : 'transparent'};
          border:1px solid ${this.selected === i ? '#2d3860' : 'transparent'};
        ">
          <div style="font-size:10px;color:${hasIssues ? '#fbbf24' : '#8a9bc0'};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.name}</div>
          <div style="font-size:9px;color:#3a4560">${g.moves.length} moves · ${g.status} ${hasIssues ? '⚠' : '✓'}</div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        this.selected = parseInt(el.dataset.idx);
        this._renderList();
        this._renderDetail(this.games[this.selected]);
      });
    });
  }

  _renderDetail(g) {
    const el = this.pane.querySelector('#di-detail');

    const evalScores = g.moves.map(m => m.evalAfter ?? 0);
    const sparkline  = this._sparkline(evalScores);
    const sideBalance = { black: g.moves.filter(m => m.side === 'black').length, white: g.moves.filter(m => m.side === 'white').length };
    const featSample  = g.moves.find(m => m.featureKey)?.featureKey ?? '(none)';
    const nnSamples   = g.moves.filter(m => m._nnFloat32).length;
    const nnDim       = g.moves.find(m => m._nnFloat32)?._nnFloat32?.length ?? 0;

    const issueHTML = g.issues.length
      ? g.issues.map(i => `<span class="dt-badge yellow" style="margin-right:4px">${i}</span>`).join('')
      : '<span class="dt-badge green">Clean</span>';

    el.innerHTML = `
      <div style="margin-bottom:8px">${issueHTML}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div>
          <div class="dt-row"><span class="dt-label">Moves</span><span class="dt-val">${g.moves.length}</span></div>
          <div class="dt-row"><span class="dt-label">Status</span><span class="dt-val">${g.status}</span></div>
          <div class="dt-row"><span class="dt-label">NN samples</span><span class="dt-val">${nnSamples} (dim ${nnDim})</span></div>
          <div class="dt-row"><span class="dt-label">Side balance</span><span class="dt-val">B${sideBalance.black} W${sideBalance.white}</span></div>
        </div>
        <div>
          <div class="dt-row"><span class="dt-label">Eval min</span><span class="dt-val bad">${g.evalRange.min}</span></div>
          <div class="dt-row"><span class="dt-label">Eval max</span><span class="dt-val good">${g.evalRange.max}</span></div>
          <div class="dt-row"><span class="dt-label">Dup positions</span><span class="dt-val ${g.dupPositions > 5 ? 'warn' : ''}">${g.dupPositions}</span></div>
        </div>
      </div>

      <div class="dt-section">Eval curve (${evalScores.length} points)</div>
      <div style="font-family:monospace;font-size:11px;color:#4a5878;letter-spacing:1px;margin:4px 0 8px;overflow:hidden;white-space:nowrap">${sparkline}</div>

      <div class="dt-section">Feature key sample</div>
      <div style="color:#4a5878;font-size:10px;word-break:break-all;margin-top:4px">${featSample}</div>

      <div class="dt-section">Move list (first 20)</div>
      <table class="dt-table" style="margin-top:4px">
        <thead><tr><th>#</th><th>Side</th><th>Notation</th><th>Before</th><th>After</th><th>ΔEval</th></tr></thead>
        <tbody>
          ${g.moves.slice(0, 20).map((m, i) => {
            const delta = (m.evalAfter ?? 0) - (m.evalBefore ?? 0);
            const dc = delta > 80 ? '#65d38a' : delta < -80 ? '#ff7676' : '#8a9bc0';
            return `
              <tr>
                <td class="mono">${i + 1}</td>
                <td><span class="dt-badge ${m.side === 'black' ? 'purple' : 'green'}">${m.side?.[0]?.toUpperCase()}</span></td>
                <td class="mono">${m.notation ?? '?'}</td>
                <td class="mono">${m.evalBefore ?? '?'}</td>
                <td class="mono">${m.evalAfter ?? '?'}</td>
                <td class="mono" style="color:${dc}">${delta > 0 ? '+' : ''}${delta}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  _sparkline(values) {
    if (!values.length) return '—';
    const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
    const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
    // Sample max 80 values
    const step = Math.max(1, Math.floor(values.length / 80));
    return values.filter((_, i) => i % step === 0)
      .map(v => bars[Math.round(((v - min) / range) * 7)])
      .join('');
  }

  _clear() {
    this.games = [];
    this.selected = null;
    this.pane.querySelector('#di-list').innerHTML = '';
    this.pane.querySelector('#di-detail').innerHTML = '';
    this.pane.querySelector('#di-status').textContent = '';
  }

  onShow() {}
}