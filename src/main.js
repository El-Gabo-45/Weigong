import { state, promotionModal } from "./state.js";
import { init, render } from "./ui/gameplay.js";
import { clearSelection } from "./state.js";
import { adaptiveMemory } from "./ai/index.js";
import { Debug, createDebugPanel } from "./debug.js";

// ── Debug: activo si la URL tiene ?debug o estamos en localhost ──
const isDev        = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const debugParam   = new URLSearchParams(location.search).get('debug');

if (isDev || debugParam !== null) {
  if (debugParam && debugParam !== '') {
    // ?debug=ai,search,perf  →  activa solo esos módulos
    Debug.enable(...debugParam.split(',').map(s => s.trim()));
  } else if (isDev) {
    // localhost sin parámetro → módulos por defecto
    Debug.enable('ui', 'rules');
  }
  createDebugPanel();
}

// ── Inicialización ──
init();

// ── Persistencia ──
try {
  const saved = localStorage.getItem('aiMemory');
  if (saved) adaptiveMemory.fromJSON(JSON.parse(saved));
} catch {}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && promotionModal.classList.contains('hidden')) {
    clearSelection();
    state.message = 'Selection cancelled.';
    render();
  }
});