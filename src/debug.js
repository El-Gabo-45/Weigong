// src/debug.js
// ══════════════════════════════════════════════════════
//  DEBUG SYSTEM — modular, zero-cost in production
//
//  Usage (import in any file):
//    import { dbg, Debug } from './debug.js';
//    dbg.ai('evaluate called', { score, depth });
//    dbg.rules.warn('illegal move blocked', move);
//    const t = dbg.perf.start('minimax');
//    dbg.perf.end(t);
//
//  Activate:
//    Browser URL : ?debug=ai,search,perf
//    localStorage: Debug.enable('ai', 'nn')
//    Node env    : DEBUG=ai,rules node src/server.js
// ══════════════════════════════════════════════════════

const IS_NODE    = typeof process !== 'undefined' && process.versions?.node;
const IS_BROWSER = typeof window  !== 'undefined';

// ── Módulos disponibles ───────────────────────────────
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
};

// ── Estado interno (un solo Set, nunca redeclarado) ───
const _active = new Set();
let   _logFn  = null;
const _panelBuffer = [];
const MAX_PANEL_LINES = 200;

// ── Cargar configuración inicial ──────────────────────
function _loadFromEnv() {
  if (IS_NODE && process.env.DEBUG) {
    process.env.DEBUG.split(',').forEach(m => _active.add(m.trim()));
  }
  if (IS_BROWSER) {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param) param.split(',').forEach(m => _active.add(m.trim()));
    const ls = localStorage.getItem('dbg');
    if (ls) ls.split(',').forEach(m => _active.add(m.trim()));
  }
}
_loadFromEnv();

// ── Colores ANSI para Node ────────────────────────────
const ANSI = {
  ai: '\x1b[94m', rules: '\x1b[92m', nn: '\x1b[93m',
  search: '\x1b[95m', memory: '\x1b[95m', selfplay: '\x1b[96m',
  server: '\x1b[33m', ui: '\x1b[37m', perf: '\x1b[33m',
  warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m',
};

// ── Panel visual (browser) ────────────────────────────
function _panelLog(module, level, ts, args) {
  const panel = document.getElementById('dbgPanelList');
  if (!panel) return;
  _panelBuffer.push({ module, level, ts, args });
  if (_panelBuffer.length > MAX_PANEL_LINES) _panelBuffer.shift();
  _renderPanel();
}

function _renderPanel() {
  const list = document.getElementById('dbgPanelList');
  if (!list) return;
  list.innerHTML = _panelBuffer.slice().reverse().map(({ module, level, ts, args }) => {
    const color   = MODULES[module]?.color ?? '#aaa';
    const text    = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const lvlIcon = level === 'warn' ? '⚠' : level === 'error' ? '✖' : '·';
    return `<div class="dbg-line dbg-${level}">
      <span class="dbg-ts">${ts}</span>
      <span class="dbg-mod" style="color:${color}">[${module.toUpperCase()}]</span>
      <span class="dbg-lvl">${lvlIcon}</span>
      <span class="dbg-msg">${text}</span>
    </div>`;
  }).join('');
}

// ── Logger central ────────────────────────────────────
function _log(module, level, args) {
  if (!_active.has(module) && !_active.has('all')) return;
  const ts    = new Date().toISOString().slice(11, 23);
  const label = (MODULES[module]?.label ?? module.toUpperCase()).padEnd(8);
  if (_logFn) _logFn({ module, level, ts, args });
  if (IS_NODE) {
    const color = ANSI[module] ?? ANSI.reset;
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

// ── Crea el logger de un módulo ───────────────────────
function _makeLogger(module) {
  const fn     = (...args) => _log(module, 'info',  args);
  fn.info      = (...args) => _log(module, 'info',  args);
  fn.warn      = (...args) => _log(module, 'warn',  args);
  fn.error     = (...args) => _log(module, 'error', args);

  fn.group = (label, data) => {
    if (!_active.has(module) && !_active.has('all')) return;
    if (IS_NODE) {
      _log(module, 'info', [`── ${label} ──`]);
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) console.log(`   ${k}:`, v);
      }
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

  return fn;
}

// ── Objeto dbg — declarado UNA sola vez ──────────────
export const dbg = Object.fromEntries(
  Object.keys(MODULES).map(m => [m, _makeLogger(m)])
);

// Extender perf sin redeclarar dbg
dbg.perf.start = (label) => ({ label, t: performance.now() });

dbg.perf.end = ({ label, t }) => {
  const ms = (performance.now() - t).toFixed(2);
  _log('perf', 'info', [`⏱ ${label}: ${ms}ms`]);
  return parseFloat(ms);
};

dbg.perf.wrap = (label, fn) => (...args) => {
  const t = performance.now();
  const r = fn(...args);
  _log('perf', 'info', [`⏱ ${(performance.now() - t).toFixed(2)}ms  ${label}`]);
  return r;
};

// ── API pública Debug ─────────────────────────────────
export const Debug = {
  enable(...modules) {
    modules.forEach(m => _active.add(m));
    if (IS_BROWSER) localStorage.setItem('dbg', [..._active].join(','));
    return this;
  },
  disable(...modules) {
    modules.forEach(m => _active.delete(m));
    if (IS_BROWSER) localStorage.setItem('dbg', [..._active].join(','));
    return this;
  },
  enableAll()  { _active.add('all'); return this; },
  disableAll() {
    _active.clear();
    if (IS_BROWSER) localStorage.removeItem('dbg');
    return this;
  },
  isActive: (m) => _active.has(m) || _active.has('all'),
  onLog:    (fn) => { _logFn = fn; },
  status:   () => ({ active: [..._active], modules: Object.keys(MODULES) }),
};

// ── Panel visual (solo browser) ───────────────────────
export function createDebugPanel() {
  if (!IS_BROWSER || document.getElementById('dbgPanel')) return;

  const style = document.createElement('style');
  style.textContent = `
    #dbgPanel {
      position:fixed; bottom:0; right:0; width:min(720px,100vw);
      height:260px; background:#0d1017; border-top:1px solid #2d3442;
      border-left:1px solid #2d3442; border-radius:12px 0 0 0;
      font-family:monospace; font-size:11px; z-index:9999;
      display:flex; flex-direction:column;
      box-shadow:-4px -4px 24px rgba(0,0,0,.5);
    }
    #dbgHeader {
      display:flex; align-items:center; gap:6px; padding:6px 10px;
      border-bottom:1px solid #2d3442; background:#111520;
      flex-shrink:0; flex-wrap:wrap;
    }
    #dbgTitle { color:#8ab4ff; font-weight:700; margin-right:4px; white-space:nowrap; }
    #dbgMods  { display:flex; gap:4px; flex-wrap:wrap; flex:1; }
    .dbg-tog  {
      background:rgba(255,255,255,.04); border:1px solid #2d3442;
      border-radius:6px; color:#555; padding:2px 7px;
      cursor:pointer; font-size:10px; font-family:monospace;
      transition: color .1s, border-color .1s;
    }
    .dbg-tog.on { border-color:var(--mc,#8ab4ff); color:var(--mc,#8ab4ff); }
    .dbg-tog:hover { color:#f3f6fb; }
    #dbgClear, #dbgClose {
      background:transparent; border:1px solid #2d3442; border-radius:6px;
      color:#555; padding:2px 8px; cursor:pointer; font-size:10px;
      font-family:monospace;
    }
    #dbgClear:hover, #dbgClose:hover { color:#f3f6fb; border-color:#666; }
    #dbgPanelList { overflow-y:auto; flex:1; padding:2px 0; }
    .dbg-line {
      display:grid; grid-template-columns:84px 86px 14px 1fr;
      gap:6px; padding:2px 10px;
    }
    .dbg-line:hover { background:rgba(255,255,255,.03); }
    .dbg-warn  { background:rgba(251,191,36,.05); }
    .dbg-error { background:rgba(255,80,80,.08); }
    .dbg-ts  { color:#333a50; }
    .dbg-mod { font-weight:700; }
    .dbg-lvl { color:#444; }
    .dbg-msg { color:#cbd5e1; white-space:pre-wrap; word-break:break-all; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'dbgPanel';
  panel.innerHTML = `
    <div id="dbgHeader">
      <span id="dbgTitle">🐞 Debug</span>
      <div id="dbgMods">${
        Object.entries(MODULES).map(([m, cfg]) =>
          `<button class="dbg-tog ${_active.has(m) || _active.has('all') ? 'on' : ''}"
                   data-mod="${m}"
                   style="--mc:${cfg.color}">${cfg.label}</button>`
        ).join('')
      }</div>
      <button id="dbgClear">Clear</button>
      <button id="dbgClose">✕</button>
    </div>
    <div id="dbgPanelList"></div>
  `;
  document.body.appendChild(panel);

  panel.querySelectorAll('.dbg-tog').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mod;
      if (_active.has(m)) { Debug.disable(m); btn.classList.remove('on'); }
      else                 { Debug.enable(m);  btn.classList.add('on');    }
    });
  });

  document.getElementById('dbgClear').addEventListener('click', () => {
    _panelBuffer.length = 0;
    _renderPanel();
  });

  document.getElementById('dbgClose').addEventListener('click', () => {
    panel.remove();
  });
}

// Auto-panel si la URL tiene ?debug=...
if (IS_BROWSER && new URLSearchParams(window.location.search).has('debug')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDebugPanel);
  } else {
    createDebugPanel();
  }
}