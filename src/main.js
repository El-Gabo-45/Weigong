import {
  state, promotionModal,
} from "./state.js";
import { init, render } from "./ui/gameplay.js";
import { clearSelection } from "./state.js";
import { adaptiveMemory } from "./ai/index.js";

// ── Inicialización Initialization──
init();

// ── Persistencia Persistant──
try { const saved = localStorage.getItem('aiMemory'); if (saved) adaptiveMemory.fromJSON(JSON.parse(saved)); } catch {}
document.addEventListener("keydown", e => { if (e.key === "Escape" && promotionModal.classList.contains("hidden")) { clearSelection(); state.message = "Selection cancelled."; render(); } });