import { state, promotionModal } from "../engine/state.js";
import { init, render } from "./ui/gameplay.js";
import { clearSelection } from "../engine/state.js";
import { adaptiveMemory } from "../engine/ai/index.js";
import { Debug, createDebugPanel, dbg } from "../engine/debug/debug.js";
import { toggleEditor, isEditorActive, ensureEditorHooks } from "./ui/editor.js";
import { showPanel, togglePanel } from "../engine/tools/tools-panel.js";
import { showStylePicker, openStylePicker } from "./ui/piece-style-selector.js";

// Detect dev environment
// ES: Detecta entorno de desarrollo
const isDev        = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const debugParam   = new URLSearchParams(location.search).get('debug');
const toolsParam   = new URLSearchParams(location.search).get('tools');

// Debug panel auto-config
// ES: Debug panel auto-config
if (isDev || debugParam !== null) {
  if (debugParam && debugParam !== '') {
    Debug.enable(...debugParam.split(',').map(s => s.trim()));
  } else if (isDev) {
    Debug.enable('ui', 'rules', 'bot', 'search');
  }
  createDebugPanel();
}

// Auto-open tools panel if ?tools in URL
// ES: Abre panel de herramientas automáticamente si ?tools en URL
if (toolsParam !== null) {
  const openTools = () => showPanel();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', openTools);
  } else {
    openTools();
  }
}

// Show piece style picker on first launch, then initialize the game
// ES: Muestra selector de estilo al primer inicio, luego inicializa el juego
showStylePicker().then(() => {
  init();
});

// Wire editor & tools buttons from HTML (after DOM ready)
// ES: Conecta botones de editor y herramientas del HTML
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureEditorHooks);
} else {
  ensureEditorHooks();
}

// Wire piece style button
// ES: Conecta el botón de estilo de piezas
const pieceStyleBtn = document.getElementById('pieceStyleBtn');
if (pieceStyleBtn) {
  pieceStyleBtn.addEventListener('click', () => openStylePicker());
}

// Debug console helpers (window.__DBG, window.dbg, window.__editor, window.__tools)
// ES: Ayudantes de depuración en consola
if (typeof window !== 'undefined') {
  window.__DBG = Debug;
  window.dbg = dbg;
  window.__editor = { toggleEditor, isEditorActive };
  window.__tools = { showPanel, togglePanel };
  console.log('🐞 Debug: Debug, dbg | Editor: __editor.toggleEditor() | Tools: __tools.togglePanel()');
}

// Persist adaptive memory from localStorage
// ES: Persiste memoria adaptativa desde localStorage
try {
  const saved = localStorage.getItem('aiMemory');
  if (saved) adaptiveMemory.fromJSON(JSON.parse(saved));
} catch {}

// Global keyboard shortcuts
// ES: Atajos de teclado globales
document.addEventListener('keydown', e => {
  // Ctrl+Shift+E: toggle board editor / activar editor
  // ES: Ctrl+Shift+E: toggle board editor / activar editor
  if (e.ctrlKey && e.shiftKey && e.key === 'E') {
    e.preventDefault();
    toggleEditor();
    return;
  }
  // Ctrl+Shift+T: toggle dev tools panel / activar panel de herramientas
  // ES: Ctrl+Shift+T: toggle dev tools panel / activar panel de herramientas
  if (e.ctrlKey && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    togglePanel();
    return;
  }
  // Escape: cancel selection (not in editor mode)
  // ES: Escape: cancel selection (not in editor mode)
  if (e.key === 'Escape' && promotionModal.classList.contains('hidden') && !isEditorActive()) {
    clearSelection();
    state.message = 'Selection cancelled.';
    render();
  }
});