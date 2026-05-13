// src/debug.js
// ══════════════════════════════════════════════════════
//  PROFESSIONAL DEBUG SYSTEM
//  Features:
//    • Zero-cost when disabled (all branches check _active)
//    • Persistent profiling: calls, total, avg, min, max
//    • Browser panel: module toggles, text search, level filter
//    • CLI integration via debug-cli.js
//    • JSON export of profiling data
//    • fn.assert(), perf.wrapAsync(), sparkline helper
// ══════════════════════════════════════════════════════

const IS_NODE    = typeof process !== 'undefined' && process.versions?.node;
const IS_BROWSER = typeof window  !== 'undefined';

// ── Módulos ───────────────────────────────────────────
const MODULES = {
  ai:       { color: '#8ab4ff', label: 'AI'       },
  rules:    { color: '#65d38a', label: 'RULES'    },
  nn:       { color: '#ff9f4a', label: 'NN'       },
  search:   { color: '#c084fc', label: 'SEARCH'   },
  memory:   { color: '#f9a8d4', label: 'MEMORY'   },
  selfplay: { color: '#34d399', label: 'SELFPLAY' },
  server:   { color: '#fb923c', label: 'SERVER'   },
  ui:       { color: '#94a3b8', label: 'UI'       },
  perf:     { color: '#fbbf24', label: 'PERF'     },
  bot:      { color: '#a78bfa', label: 'BOT'      },
  moves:    { color: '#6ee7b7', label: 'MOVES'    },
};

// ── Estado interno ────────────────────────────────────
const _active      = new Set();
let   _logFn       = null;
let   _errorFn     = null;
const _panelBuffer = [];
const MAX_PANEL_LINES = 500;

let _panelFilterModule = 'all';
let _panelFilterText   = '';
let _panelFilterLevel  = 'all';

// ── Profiler ──────────────────────────────────────────
const _perfCounts = {};
const _perfTimes  = {};
const _perfMin    = {};
const _perfMax    = {};

// ── Init: cargar desde env / URL / localStorage ───────
function _loadFromEnv() {
  if (IS_NODE && process.env.DEBUG) {
    process.env.DEBUG.split(',').forEach(m => _active.add(m.trim()));
  }
  if (IS_BROWSER) {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param) param.split(',').forEach(m => _active.add(m.trim()));
    try {
      const ls = localStorage.getItem('dbg');
      if (ls) ls.split(',').forEach(m => _active.add(m.trim()));
    } catch {}
  }
}
_loadFromEnv();

// ── ANSI para Node ────────────────────────────────────
const ANSI = {
  ai:'\x1b[94m', rules:'\x1b[92m', nn:'\x1b[93m', search:'\x1b[95m',
  memory:'\x1b[95m', selfplay:'\x1b[96m', server:'\x1b[33m',
  ui:'\x1b[37m', perf:'\x1b[33m', bot:'\x1b[95m', moves:'\x1b[92m',
  warn:'\x1b[33m', error:'\x1b[31m', reset:'\x1b[0m', bold:'\x1b[1m',
};

// ── Panel browser ─────────────────────────────────────
function _panelLog(module, level, ts, args) {
  if (!document.getElementById('dbgPanelList')) return;
  _panelBuffer.push({
    module, level, ts,
    args: args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    }),
  });
  if (_panelBuffer.length > MAX_PANEL_LINES) _panelBuffer.shift();
  _renderPanel();
}

function _matchesFilter(entry) {
  if (_panelFilterModule !== 'all' && entry.module !== _panelFilterModule) return false;
  if (_panelFilterLevel  !== 'all' && entry.level  !== _panelFilterLevel)  return false;
  if (_panelFilterText) {
    const needle = _panelFilterText.toLowerCase();
    if (!entry.args.join(' ').toLowerCase().includes(needle) &&
        !entry.module.includes(needle)) return false;
  }
  return true;
}

function _escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _renderPanel() {
  const list = document.getElementById('dbgPanelList');
  if (!list) return;
  const visible = _panelBuffer.filter(_matchesFilter).slice().reverse();
  list.innerHTML = visible.map(({ module, level, ts, args }) => {
    const color   = MODULES[module]?.color ?? '#aaa';
    const rawText = args.join(' ');
    let text = _escapeHtml(rawText);
    if (_panelFilterText) {
      const re = new RegExp(_escapeHtml(_panelFilterText).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
      text = text.replace(re, m => `<mark style="background:#fbbf2440;color:#fbbf24;border-radius:2px">${m}</mark>`);
    }
    const lvlIcon = level === 'warn' ? '⚠' : level === 'error' ? '✖' : '·';
    return `<div class="dbg-line dbg-${level}">
      <span class="dbg-ts">${ts}</span>
      <span class="dbg-mod" style="color:${color}">[${(MODULES[module]?.label ?? module).toUpperCase()}]</span>
      <span class="dbg-lvl">${lvlIcon}</span>
      <span class="dbg-msg">${text}</span>
    </div>`;
  }).join('');
  const badge = document.getElementById('dbgCount');
  if (badge) badge.textContent = `${visible.length}/${_panelBuffer.length}`;
}

// ── Logger central ────────────────────────────────────
function _log(module, level, args) {
  if (!_active.has(module) && !_active.has('all')) return;
  const ts    = new Date().toISOString().slice(11, 23);
  const label = (MODULES[module]?.label ?? module.toUpperCase()).padEnd(8);
  if (_logFn) _logFn({ module, level, ts, args });
  if (IS_NODE) {
    const color  = ANSI[module] ?? ANSI.reset;
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](`${color}[${ts}] ${label}${ANSI.reset}`, ...args);
  } else {
    const color  = MODULES[module]?.color ?? '#aaa';
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](
      `%c[${ts}] ${label}`, `color:${color};font-weight:700;font-family:monospace`,
      ...args
    );
    _panelLog(module, level, ts, args);
  }
}

// ── Logger factory ────────────────────────────────────
function _makeLogger(module) {
  const fn    = (...args) => _log(module, 'info',  args);
  fn.info     = (...args) => _log(module, 'info',  args);
  fn.warn     = (...args) => _log(module, 'warn',  args);
  fn.error    = (...args) => { _log(module, 'error', args); if (_errorFn) _errorFn({ module, args }); };

  fn.group = (label, data) => {
    if (!_active.has(module) && !_active.has('all')) return;
    if (IS_NODE) {
      _log(module, 'info', [`══ ${label} ══`]);
      if (data && typeof data === 'object')
        for (const [k, v] of Object.entries(data)) console.log(`   ${k}:`, v);
    } else {
      const color = MODULES[module]?.color ?? '#aaa';
      console.groupCollapsed(`%c[${module.toUpperCase()}] ${label}`, `color:${color};font-weight:700`);
      if (data) console.log(data);
      console.groupEnd();
    }
  };

  fn.table = (data) => {
    if (!_active.has(module) && !_active.has('all')) return;
    console.table(data);
  };

  fn.time = (label, start) => {
    const ms = (performance.now() - start).toFixed(2);
    _log(module, 'info', [`⏱ ${label}: ${ms}ms`]);
    return parseFloat(ms);
  };

  fn.count = (label) => {
    _perfCounts[label] = (_perfCounts[label] ?? 0) + 1;
    if (_active.has('perf') || _active.has('all'))
      _log(module, 'info', [`# ${label} — call #${_perfCounts[label]}`]);
  };

  // assert: only fires (as error) when condition is falsy
  fn.assert = (condition, ...args) => {
    if (!condition) _log(module, 'error', ['ASSERT FAILED:', ...args]);
  };

  return fn;
}

// ── dbg object ───────────────────────────────────────
export const dbg = Object.fromEntries(
  Object.keys(MODULES).map(m => [m, _makeLogger(m)])
);

// ── Profiler ──────────────────────────────────────────
dbg.perf.start = (label) => ({ label, t: performance.now() });

dbg.perf.end = ({ label, t }) => {
  const ms = parseFloat((performance.now() - t).toFixed(2));
  _perfCounts[label] = (_perfCounts[label] ?? 0) + 1;
  _perfTimes[label]  = (_perfTimes[label]  ?? 0) + ms;
  _perfMin[label]    = _perfMin[label] === undefined ? ms : Math.min(_perfMin[label], ms);
  _perfMax[label]    = _perfMax[label] === undefined ? ms : Math.max(_perfMax[label], ms);
  if (_active.has('perf') || _active.has('all')) {
    const avg = (_perfTimes[label] / _perfCounts[label]).toFixed(2);
    _log('perf', 'info', [`⏱ ${label}: ${ms.toFixed(2)}ms  (avg ${avg} × ${_perfCounts[label]})`]);
  }
  return ms;
};

dbg.perf.wrap = (label, fn) => (...args) => {
  const t = performance.now();
  const r = fn(...args);
  const ms = parseFloat((performance.now() - t).toFixed(2));
  _perfCounts[label] = (_perfCounts[label] ?? 0) + 1;
  _perfTimes[label]  = (_perfTimes[label]  ?? 0) + ms;
  if (_active.has('perf') || _active.has('all'))
    _log('perf', 'info', [`⏱ ${label}: ${ms.toFixed(2)}ms`]);
  return r;
};

dbg.perf.wrapAsync = (label, fn) => async (...args) => {
  const t = performance.now();
  const r = await fn(...args);
  const ms = parseFloat((performance.now() - t).toFixed(2));
  _perfCounts[label] = (_perfCounts[label] ?? 0) + 1;
  _perfTimes[label]  = (_perfTimes[label]  ?? 0) + ms;
  if (_active.has('perf') || _active.has('all'))
    _log('perf', 'info', [`⏱ async ${label}: ${ms.toFixed(2)}ms`]);
  return r;
};

dbg.perf.report = (asObject = false) => {
  const labels = Object.keys(_perfCounts).sort((a, b) => (_perfTimes[b]??0) - (_perfTimes[a]??0));
  if (asObject) {
    return labels.map(l => ({
      label: l,
      calls: _perfCounts[l],
      total: +(_perfTimes[l]??0).toFixed(2),
      avg:   +((_perfTimes[l]??0) / _perfCounts[l]).toFixed(2),
      min:   +(_perfMin[l]??0).toFixed(2),
      max:   +(_perfMax[l]??0).toFixed(2),
    }));
  }
  if (!labels.length) return '\n  (no profiling data yet)\n';
  const rows = ['',
    '══════════════════════ PROFILING REPORT ══════════════════════',
    '  Label                          Calls   Total(ms)   Avg(ms)   Min    Max',
    '  ─────────────────────────────  ─────   ─────────   ───────   ────   ────',
  ];
  for (const l of labels) {
    const avg = ((_perfTimes[l]??0) / _perfCounts[l]).toFixed(2);
    rows.push(
      `  ${l.padEnd(29)} ${String(_perfCounts[l]).padStart(5)}   ` +
      `${(_perfTimes[l]??0).toFixed(1).padStart(8)}   ` +
      `${avg.padStart(7)}   ${(_perfMin[l]??0).toFixed(2).padStart(5)}   ` +
      `${(_perfMax[l]??0).toFixed(2).padStart(5)}`
    );
  }
  rows.push('══════════════════════════════════════════════════════════════\n');
  return rows.join('\n');
};

dbg.perf.reset = () => {
  for (const k of Object.keys(_perfCounts)) delete _perfCounts[k];
  for (const k of Object.keys(_perfTimes))  delete _perfTimes[k];
  for (const k of Object.keys(_perfMin))    delete _perfMin[k];
  for (const k of Object.keys(_perfMax))    delete _perfMax[k];
  _log('perf', 'info', ['Profiling stats reset.']);
};

// ASCII sparkline: array of numbers → '▁▂▄▆█▇▅▃'
dbg.perf.sparkline = (values) => {
  if (!values?.length) return '';
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
  return values.map(v => bars[Math.round(((v - min) / range) * 7)]).join('');
};

dbg.mark = (label, data) => {
  if (!_active.has('all') && !_active.has('perf') && !_active.has('ai')) return;
  _log('perf', 'info', [`📍 ${label}`, data ?? '']);
};

// ── Debug API ─────────────────────────────────────────
export const Debug = {
  enable(...modules) {
    modules.forEach(m => _active.add(m));
    if (IS_BROWSER) try { localStorage.setItem('dbg', [..._active].join(',')); } catch {}
    return this;
  },
  disable(...modules) {
    modules.forEach(m => _active.delete(m));
    if (IS_BROWSER) try { localStorage.setItem('dbg', [..._active].join(',')); } catch {}
    return this;
  },
  enableAll()  { _active.add('all'); return this; },
  disableAll() {
    _active.clear();
    if (IS_BROWSER) try { localStorage.removeItem('dbg'); } catch {}
    return this;
  },
  isActive: (m) => _active.has(m) || _active.has('all'),
  onLog:    (fn) => { _logFn = fn; },
  onError:  (fn) => { _errorFn = fn; },
  status:   () => ({
    active:  [..._active],
    modules: Object.keys(MODULES),
    perfEntries: Object.keys(_perfCounts).length,
    totalPerfMs: +Object.values(_perfTimes).reduce((a,b)=>a+b,0).toFixed(1),
  }),
  exportPerf() {
    return JSON.stringify({ counts:_perfCounts, times:_perfTimes, min:_perfMin, max:_perfMax }, null, 2);
  },
  // Panel filter — usable from devtools: Debug.filterModule('search')
  filterModule: (mod) => { _panelFilterModule = mod; _renderPanel(); },
  filterText:   (txt) => { _panelFilterText   = txt; _renderPanel(); },
  filterLevel:  (lvl) => { _panelFilterLevel  = lvl; _renderPanel(); },

  cmd(command) {
    switch (command) {
      case 'perf':
      case 'profile':     console.log(dbg.perf.report()); break;
      case 'perf:reset':  dbg.perf.reset(); break;
      case 'perf:table':  console.table(dbg.perf.report(true)); break;
      case 'status':      console.table(Debug.status()); break;
      case 'panel':       createDebugPanel(); break;
      case 'clear':       _panelBuffer.length = 0; _renderPanel(); break;
      default:
        console.log('Commands: perf | perf:reset | perf:table | status | panel | clear');
    }
  },
};

// ── Panel ─────────────────────────────────────────────
export function createDebugPanel() {
  if (!IS_BROWSER || document.getElementById('dbgPanel')) return;

  const style = document.createElement('style');
  style.textContent = `
    #dbgPanel {
      position:fixed; bottom:0; right:0; width:min(880px,100vw);
      height:320px; background:#0d1017; border-top:1px solid #2d3442;
      border-left:1px solid #2d3442; border-radius:12px 0 0 0;
      font-family:'Fira Code','Cascadia Code',monospace; font-size:11px;
      z-index:9999; display:flex; flex-direction:column;
      box-shadow:-4px -4px 28px rgba(0,0,0,.6);
    }
    #dbgHeader {
      display:flex; align-items:center; gap:5px; padding:5px 8px;
      border-bottom:1px solid #2d3442; background:#111520;
      flex-shrink:0; flex-wrap:wrap; row-gap:4px;
    }
    #dbgTitle  { color:#8ab4ff; font-weight:700; font-size:12px; white-space:nowrap; }
    #dbgCount  { color:#333a50; font-size:10px; }
    #dbgMods   { display:flex; gap:3px; flex-wrap:wrap; flex:1; }
    .dbg-tog   {
      background:rgba(255,255,255,.03); border:1px solid #2d3442;
      border-radius:5px; color:#444; padding:1px 6px;
      cursor:pointer; font-size:10px; font-family:inherit;
      transition:color .1s, border-color .1s;
    }
    .dbg-tog.on    { border-color:var(--mc,#8ab4ff); color:var(--mc,#8ab4ff); }
    .dbg-tog:hover { color:#f3f6fb; border-color:#556; }
    #dbgToolbar {
      display:flex; align-items:center; gap:5px; padding:4px 8px;
      border-bottom:1px solid #161e30; background:#0f1420; flex-shrink:0;
    }
    #dbgSearch {
      flex:1; background:#161e30; border:1px solid #2d3442; border-radius:5px;
      color:#cbd5e1; font-family:inherit; font-size:10px; padding:2px 8px; outline:none;
    }
    #dbgSearch:focus { border-color:#8ab4ff44; box-shadow:0 0 0 2px #8ab4ff18; }
    #dbgSearch::placeholder { color:#2d3550; }
    .dbg-lvl-btn {
      background:transparent; border:1px solid #2d3442; border-radius:5px;
      color:#444; padding:1px 7px; cursor:pointer; font-size:10px; font-family:inherit;
    }
    .dbg-lvl-btn.on        { border-color:#8ab4ff; color:#8ab4ff; }
    .dbg-lvl-btn.warn.on   { border-color:#fb923c; color:#fb923c; }
    .dbg-lvl-btn.error.on  { border-color:#f87171; color:#f87171; }
    #dbgActions { display:flex; gap:4px; margin-left:auto; }
    .dbg-act {
      background:transparent; border:1px solid #2d3442; border-radius:5px;
      color:#444; padding:1px 7px; cursor:pointer; font-size:10px; font-family:inherit;
    }
    .dbg-act:hover { color:#f3f6fb; border-color:#667; }
    #dbgPanelList { overflow-y:auto; flex:1; }
    #dbgPanelList::-webkit-scrollbar { width:5px; }
    #dbgPanelList::-webkit-scrollbar-thumb { background:rgba(255,255,255,.08); border-radius:3px; }
    .dbg-line {
      display:grid; grid-template-columns:84px 78px 14px 1fr;
      gap:5px; padding:2px 8px; border-left:2px solid transparent;
    }
    .dbg-line:hover  { background:rgba(255,255,255,.025); border-left-color:#2d3442; }
    .dbg-warn        { background:rgba(251,191,36,.04);   border-left-color:#fbbf2455 !important; }
    .dbg-error       { background:rgba(248,113,113,.07);  border-left-color:#f8717155 !important; }
    .dbg-ts  { color:#252d45; font-size:10px; }
    .dbg-mod { font-weight:700; font-size:10px; }
    .dbg-lvl { color:#2d3442; }
    .dbg-msg { color:#c0cde0; white-space:pre-wrap; word-break:break-all; }
    mark { border-radius:2px; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'dbgPanel';
  panel.innerHTML = `
    <div id="dbgHeader">
      <span id="dbgTitle">🐞 Debug</span>
      <span id="dbgCount">0/0</span>
      <div id="dbgMods">
        <button class="dbg-tog" data-mod="all" style="--mc:#ffffff">ALL</button>
        ${Object.entries(MODULES).map(([m, cfg]) =>
          `<button class="dbg-tog" data-mod="${m}" style="--mc:${cfg.color}">${cfg.label}</button>`
        ).join('')}
      </div>
    </div>
    <div id="dbgToolbar">
      <input id="dbgSearch" placeholder="Search logs…" autocomplete="off" spellcheck="false" />
      <button class="dbg-lvl-btn on" data-lvl="all">ALL</button>
      <button class="dbg-lvl-btn warn" data-lvl="warn">⚠ WARN</button>
      <button class="dbg-lvl-btn error" data-lvl="error">✖ ERR</button>
      <div id="dbgActions">
        <button class="dbg-act" id="dbgPerf" title="Print profiling report to console">📊 Perf</button>
        <button class="dbg-act" id="dbgClear">Clear</button>
        <button class="dbg-act" id="dbgClose">✕</button>
      </div>
    </div>
    <div id="dbgPanelList"></div>
  `;
  document.body.appendChild(panel);

  // Sync toggle state from _active
  panel.querySelectorAll('.dbg-tog').forEach(btn => {
    const m = btn.dataset.mod;
    if (m === 'all' && _active.has('all')) btn.classList.add('on');
    else if (m !== 'all' && _active.has(m) && !_active.has('all')) btn.classList.add('on');

    btn.addEventListener('click', () => {
      if (m === 'all') {
        if (_active.has('all')) { Debug.disableAll(); panel.querySelectorAll('.dbg-tog').forEach(b => b.classList.remove('on')); }
        else { Debug.enableAll(); panel.querySelectorAll('.dbg-tog').forEach(b => b.classList.add('on')); }
      } else {
        if (_active.has(m)) { Debug.disable(m); btn.classList.remove('on'); }
        else                 { Debug.enable(m);  btn.classList.add('on');    }
        // De-sync "all" button if individual toggle
        panel.querySelector('[data-mod="all"]')?.classList.toggle('on', _active.has('all'));
      }
      _renderPanel();
    });
  });

  panel.querySelector('#dbgSearch').addEventListener('input', e => {
    _panelFilterText = e.target.value.trim();
    _renderPanel();
  });

  panel.querySelectorAll('.dbg-lvl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _panelFilterLevel = btn.dataset.lvl;
      panel.querySelectorAll('.dbg-lvl-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _renderPanel();
    });
  });

  panel.querySelector('#dbgPerf').addEventListener('click',  () => console.log(dbg.perf.report()));
  panel.querySelector('#dbgClear').addEventListener('click', () => { _panelBuffer.length = 0; _renderPanel(); });
  panel.querySelector('#dbgClose').addEventListener('click', () => panel.remove());

  _renderPanel();
}

// ── Auto-panel si URL tiene ?debug ────────────────────
if (IS_BROWSER && new URLSearchParams(window.location.search).has('debug')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createDebugPanel);
  else createDebugPanel();
}

// ── Node: print perf report on exit ──────────────────
if (IS_NODE) {
  process.on('exit', () => {
    if (_active.has('perf') || _active.has('all')) {
      const r = dbg.perf.report();
      if (r.length > 80) process.stderr.write(r + '\n');
    }
  });
}