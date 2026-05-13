// tools/tools-panel.js
// ══════════════════════════════════════════════════════════════
//  TOOLS PANEL — Floating debug shell for all analysis tools
//  Usage: import './tools/tools-panel.js' in main.js (dev only)
//  Or:    ?tools in URL to auto-open
// ══════════════════════════════════════════════════════════════

import { AttackOverlay }      from './attack-overlay.js';
import { SearchTreeViewer }   from './search-tree.js';
import { EvalHeatmap }        from './eval-heatmap.js';
import { DatasetInspector }   from './dataset-inspector.js';
import { BenchmarkSuite }     from './benchmark-suite.js';
import { PerftVisual }        from './perft-visual.js';
import { NNInspector }        from './nn-inspector.js';
import { ReplayAnalyzer }     from './replay-analyzer.js';

const PANEL_ID = 'devToolsPanel';
const TABS = [
  { id: 'attack',    label: '⚔ Attack',    color: '#ff7676', cls: AttackOverlay },
  { id: 'search',    label: '🌳 Search',    color: '#c084fc', cls: SearchTreeViewer },
  { id: 'heatmap',   label: '🔥 Heatmap',   color: '#fb923c', cls: EvalHeatmap },
  { id: 'dataset',   label: '📦 Dataset',   color: '#34d399', cls: DatasetInspector },
  { id: 'bench',     label: '⚡ Bench',     color: '#fbbf24', cls: BenchmarkSuite },
  { id: 'perft',     label: '🌿 Perft',     color: '#65d38a', cls: PerftVisual },
  { id: 'nn',        label: '🧠 NN',        color: '#8ab4ff', cls: NNInspector },
  { id: 'replay',    label: '▶ Replay',    color: '#f9a8d4', cls: ReplayAnalyzer },
];

const CSS = `
#${PANEL_ID} {
  position: fixed;
  bottom: 0; right: 0;
  width: min(1100px, 100vw);
  height: 420px;
  background: #0b0e14;
  border-top: 1px solid #1e2535;
  border-left: 1px solid #1e2535;
  border-radius: 14px 0 0 0;
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  box-shadow: -6px -6px 40px rgba(0,0,0,.75);
  user-select: none;
  resize: vertical;
  overflow: hidden;
  min-height: 200px;
}
#dtHeader {
  display: flex;
  align-items: center;
  gap: 0;
  background: #0d1119;
  border-bottom: 1px solid #1e2535;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
#dtHeader::-webkit-scrollbar { display: none; }
.dt-tab {
  padding: 8px 13px;
  border: 0;
  border-right: 1px solid #1a2030;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #3a4560;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: color .12s, border-color .12s;
  letter-spacing: .03em;
}
.dt-tab:hover  { color: #8a9bc0; }
.dt-tab.active { color: var(--tc,#8ab4ff); border-bottom-color: var(--tc,#8ab4ff); background: rgba(255,255,255,.02); }
#dtDragBar {
  margin-left: auto;
  padding: 6px 10px;
  color: #2d3550;
  cursor: ns-resize;
  font-size: 14px;
  flex-shrink: 0;
}
#dtClose {
  padding: 6px 12px;
  background: transparent;
  border: 0;
  color: #2d3550;
  cursor: pointer;
  font-size: 15px;
  flex-shrink: 0;
}
#dtClose:hover { color: #ff7676; }
#dtBody {
  flex: 1;
  overflow: hidden;
  position: relative;
}
.dt-pane {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 10px 12px;
  display: none;
}
.dt-pane.active { display: block; }
.dt-pane::-webkit-scrollbar { width: 5px; }
.dt-pane::-webkit-scrollbar-thumb { background: rgba(255,255,255,.06); border-radius:3px; }

/* ── Shared widget styles used by all tools ── */
.dt-row   { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.dt-label { color: #3a4560; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; min-width: 80px; }
.dt-val   { color: #c0cde0; }
.dt-val.good  { color: #65d38a; }
.dt-val.warn  { color: #fbbf24; }
.dt-val.bad   { color: #ff7676; }
.dt-section { margin-top: 10px; margin-bottom: 4px; color: #2d3860; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; border-top: 1px solid #131824; padding-top: 6px; }
.dt-btn {
  background: rgba(255,255,255,.04);
  border: 1px solid #1e2535;
  border-radius: 6px;
  color: #6e7f9e;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  padding: 4px 10px;
  cursor: pointer;
  transition: color .1s, border-color .1s;
  user-select: none;
}
.dt-btn:hover   { color: #c0cde0; border-color: #2d3860; }
.dt-btn.primary { border-color: #8ab4ff55; color: #8ab4ff; }
.dt-btn.primary:hover { border-color: #8ab4ff; }
.dt-btn.danger  { border-color: #ff767655; color: #ff7676; }
.dt-select {
  background: #0f141c;
  border: 1px solid #1e2535;
  border-radius: 5px;
  color: #8a9bc0;
  font-family: inherit;
  font-size: 10px;
  padding: 3px 6px;
  outline: none;
}
.dt-input {
  background: #0f141c;
  border: 1px solid #1e2535;
  border-radius: 5px;
  color: #8a9bc0;
  font-family: inherit;
  font-size: 10px;
  padding: 3px 8px;
  outline: none;
  width: 80px;
}
.dt-input:focus, .dt-select:focus { border-color: #2d3860; }

.dt-bar-wrap { display: flex; align-items: center; gap: 6px; }
.dt-bar-outer { flex: 1; height: 5px; background: #111824; border-radius: 999px; overflow: hidden; min-width: 80px; }
.dt-bar-inner { height: 100%; border-radius: 999px; transition: width .3s; }

.dt-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.dt-table th { color: #2d3860; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; padding: 4px 8px; text-align: left; border-bottom: 1px solid #111824; }
.dt-table td { padding: 3px 8px; color: #8a9bc0; border-bottom: 1px solid #0d1017; }
.dt-table tr:hover td { background: rgba(255,255,255,.015); color: #c0cde0; }
.dt-table td.mono { font-family: inherit; color: #6e7f9e; }

.dt-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .05em;
}
.dt-badge.green  { background: rgba(101,211,138,.12); color: #65d38a; }
.dt-badge.blue   { background: rgba(138,180,255,.12); color: #8ab4ff; }
.dt-badge.yellow { background: rgba(251,191,36,.12);  color: #fbbf24; }
.dt-badge.red    { background: rgba(255,118,118,.12); color: #ff7676; }
.dt-badge.purple { background: rgba(192,132,252,.12); color: #c084fc; }
`;

let _panel = null;
let _activeTab = TABS[0].id;
let _tools = {};

function injectCSS() {
  if (document.getElementById('dtStyles')) return;
  const s = document.createElement('style');
  s.id = 'dtStyles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function buildPanel() {
  if (document.getElementById(PANEL_ID)) return;
  injectCSS();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  const header = document.createElement('div');
  header.id = 'dtHeader';

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.className = 'dt-tab' + (tab.id === _activeTab ? ' active' : '');
    btn.textContent = tab.label;
    btn.style.setProperty('--tc', tab.color);
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => activateTab(tab.id));
    header.appendChild(btn);
  }

  const drag = document.createElement('div');
  drag.id = 'dtDragBar';
  drag.title = 'Drag to resize';
  drag.textContent = '⣿';
  header.appendChild(drag);

  const close = document.createElement('button');
  close.id = 'dtClose';
  close.title = 'Close (Ctrl+Shift+T)';
  close.textContent = '✕';
  close.addEventListener('click', hidePanel);
  header.appendChild(close);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.id = 'dtBody';

  for (const tab of TABS) {
    const pane = document.createElement('div');
    pane.className = 'dt-pane' + (tab.id === _activeTab ? ' active' : '');
    pane.id = `dt-pane-${tab.id}`;
    body.appendChild(pane);

    // Lazy-init each tool when its tab is first shown
    if (tab.id === _activeTab) initTool(tab);
  }

  panel.appendChild(body);
  document.body.appendChild(panel);
  _panel = panel;

  // Resize handle (drag bar)
  let dragging = false, startY = 0, startH = 0;
  drag.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startH = panel.offsetHeight;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    panel.style.height = Math.max(200, Math.min(window.innerHeight - 60, startH + delta)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

function initTool(tab) {
  if (_tools[tab.id]) return;
  const pane = document.getElementById(`dt-pane-${tab.id}`);
  if (!pane) return;
  try {
    _tools[tab.id] = new tab.cls(pane);
  } catch (e) {
    pane.innerHTML = `<div style="color:#ff7676;padding:12px">Failed to load tool: ${e.message}</div>`;
    console.error('[DevTools] init error', tab.id, e);
  }
}

function activateTab(id) {
  _activeTab = id;
  document.querySelectorAll('.dt-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === id);
  });
  document.querySelectorAll('.dt-pane').forEach(p => {
    p.classList.toggle('active', p.id === `dt-pane-${id}`);
  });
  const tab = TABS.find(t => t.id === id);
  if (tab) initTool(tab);
  _tools[id]?.onShow?.();
}

export function showPanel() {
  if (!_panel) buildPanel(); else _panel.style.display = 'flex';
  _tools[_activeTab]?.onShow?.();
}

export function hidePanel() {
  if (_panel) _panel.style.display = 'none';
}

export function togglePanel() {
  if (!_panel || _panel.style.display === 'none') showPanel();
  else hidePanel();
}

// Keyboard shortcut: Ctrl+Shift+T
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); togglePanel(); }
});

// Auto-open on ?tools
if (new URLSearchParams(location.search).has('tools')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showPanel);
  else showPanel();
}

// Floating toggle button (always visible in dev)
function addToggleButton() {
  const btn = document.createElement('button');
  btn.id = 'dtToggleBtn';
  btn.title = 'Dev Tools (Ctrl+Shift+T)';
  btn.textContent = '🛠';
  btn.style.cssText = `
    position:fixed; bottom:12px; left:12px; z-index:9999;
    background:#0d1119; border:1px solid #1e2535; border-radius:8px;
    color:#3a4560; font-size:16px; width:34px; height:34px;
    cursor:pointer; transition:color .15s, border-color .15s;
    display:grid; place-items:center;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.color = '#8ab4ff'; btn.style.borderColor = '#2d3860'; });
  btn.addEventListener('mouseleave', () => { btn.style.color = '#3a4560'; btn.style.borderColor = '#1e2535'; });
  btn.addEventListener('click', togglePanel);
  document.body.appendChild(btn);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggleButton);
else addToggleButton();