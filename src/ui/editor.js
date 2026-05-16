// ═════════════════════════════════════════════════════
//  Board Editor (EN/ES)
// ES: Board Editor (EN/ES)
//  Free-edit mode: place/remove/move pieces anywhere
// Modo edición libre: colocar/quitar/mover piezas en cualquier lugar
// ═════════════════════════════════════════════════════

import { SIDE, BOARD_SIZE, PIECE_DATA, isRiverSquare } from '../../engine/constants.js';
import { render } from './gameplay.js';
import { state, messageBar, V } from '../../engine/state.js';
import { clearSelection } from '../../engine/state.js';
import { getLegalMovesForSquare } from '../../engine/rules/index.js';

const PIECE_TYPES = [
  'king', 'queen', 'general', 'elephant', 'priest', 'horse',
  'cannon', 'tower', 'carriage', 'archer', 'pawn', 'crossbow',
];

let editorMode = false;
let clipboard = null;
let editorPanel = null;

function createEditorPanel() {
  if (document.getElementById('editorPanel')) return;

  const panel = document.createElement('div');
  panel.id = 'editorPanel';
  panel.style.cssText = `
    position:fixed; top:50%; right:12px; transform:translateY(-50%);
    background:#0b0e14; border:1px solid #1e2535; border-radius:12px;
    padding:12px; z-index:9998; width:200px;
    font-family:'Fira Code',monospace; font-size:11px;
    box-shadow:-4px 4px 24px rgba(0,0,0,.6);
    display:none;
  `;

  panel.innerHTML = `
    <div style="color:#8ab4ff;font-weight:700;margin-bottom:8px;font-size:12px">🎨 Board Editor</div>
    <div style="display:flex;gap:4px;margin-bottom:8px">
      <button class="ed-side" data-side="black" style="flex:1;padding:4px;border-radius:6px;border:1px solid #1e2535;background:rgba(192,132,252,.15);color:#c084fc;cursor:pointer;font-weight:700">⚫ Black</button>
      <button class="ed-side" data-side="white" style="flex:1;padding:4px;border-radius:6px;border:1px solid #1e2535;background:rgba(101,211,138,.15);color:#65d38a;cursor:pointer;font-weight:700">⚪ White</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:8px" id="edPalette">
      ${PIECE_TYPES.map(t => {
        const data = PIECE_DATA[t];
        return `<button class="ed-piece" data-type="${t}" style="padding:3px 6px;border-radius:5px;border:1px solid #1e2535;background:#0f141c;color:#6e7f9e;cursor:pointer;font-size:10px;text-align:left">
          ${data.kanji} <span style="color:#3a4560;font-size:8px">${t}</span>
        </button>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:4px;margin-bottom:6px">
      <button id="edPlace" class="ed-btn" style="flex:1">Place</button>
      <button id="edErase" class="ed-btn" style="flex:1">Erase</button>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:6px">
      <button id="edClear" class="ed-btn" style="flex:1">🗑 Clear all</button>
      <button id="edReset" class="ed-btn" style="flex:1">↺ Reset</button>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:6px">
      <button id="edTogglePromo" class="ed-btn" style="flex:1">⭐ Promote</button>
      <button id="edClose" class="ed-btn danger" style="flex:1">✕ Close</button>
    </div>
    <div id="edStatus" style="margin-top:6px;color:#3a4560;font-size:9px;text-align:center"></div>
  `;
  document.body.appendChild(panel);
  editorPanel = panel;

  let activeSide = SIDE.BLACK;
  panel.querySelectorAll('.ed-side').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSide = btn.dataset.side;
      panel.querySelectorAll('.ed-side').forEach(b => b.style.borderColor = '#1e2535');
      btn.style.borderColor = activeSide === 'black' ? '#c084fc' : '#65d38a';
      updateStatus();
    });
  });
  panel.querySelector('[data-side="black"]').style.borderColor = '#c084fc';

  let activeType = 'pawn';
  panel.querySelectorAll('.ed-piece').forEach(btn => {
    btn.addEventListener('click', () => {
      activeType = btn.dataset.type;
      panel.querySelectorAll('.ed-piece').forEach(b => b.style.borderColor = '#1e2535');
      btn.style.borderColor = '#8ab4ff';
      updateStatus();
    });
  });
  panel.querySelector('[data-type="pawn"]').style.borderColor = '#8ab4ff';

  let action = 'place';
  let pendingPromote = false;

  const placeBtn = panel.querySelector('#edPlace');
  const eraseBtn = panel.querySelector('#edErase');
  placeBtn.style.borderColor = '#8ab4ff';
  placeBtn.addEventListener('click', () => { action = 'place'; placeBtn.style.borderColor = '#8ab4ff'; eraseBtn.style.borderColor = '#1e2535'; clearSelection(); render(); updateStatus(); });
  eraseBtn.addEventListener('click', () => { action = 'erase'; eraseBtn.style.borderColor = '#ff7676'; placeBtn.style.borderColor = '#1e2535'; clearSelection(); render(); updateStatus(); });

  panel.querySelector('#edTogglePromo').addEventListener('click', () => {
    pendingPromote = !pendingPromote;
    updateStatus(pendingPromote ? 'Promoted ON' : 'Promoted OFF');
  });

  panel.querySelector('#edClear').addEventListener('click', () => {
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++)
        state.board[r][c] = null;
    state.reserves = { white: [], black: [] };
    clearSelection();
    render();
    updateStatus('Board cleared');
  });

  panel.querySelector('#edReset').addEventListener('click', () => {
    import('../rules/index.js').then(m => {
      m.resetGame(state);
      if (editorMode) toggleEditor();
      render();
    });
  });

  panel.querySelector('#edClose').addEventListener('click', () => {
    if (editorMode) toggleEditor();
  });

  function updateStatus(msg) {
    const el = panel.querySelector('#edStatus');
    if (msg) { el.textContent = msg; return; }
    el.textContent = `${action === 'place' ? 'Placing' : 'Erasing'} ${activeSide} ${activeType}${pendingPromote ? ' (promoted)' : ''}`;
  }

  editorPanel._getState = () => ({ activeSide, activeType, action, pendingPromote });
  editorPanel._setClipboard = (data) => { clipboard = data; };
}

function hookBoardForEditor() {
  const board = document.getElementById('board');
  if (!board || board._editorHooked) return;
  board._editorHooked = true;

  board.addEventListener('click', (e) => {
    if (!editorMode) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = parseInt(cell.dataset.r);
    const c = parseInt(cell.dataset.c);
    if (isNaN(r) || isNaN(c) || r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;

    const { activeSide, activeType, action, pendingPromote } = editorPanel._getState();
    const targetPiece = state.board[r][c];

    if (action === 'erase') {
      state.board[r][c] = null;
      clearSelection();
      render();
      return;
    }

    if (action === 'place') {
      // Prevent placing pieces on the river (row 6)
      // ES: Evita colocar piezas en el río (fila 6)
      if (isRiverSquare(r)) {
        updateStatus('⛔ Cannot place on river');
        return;
      }
      if (targetPiece && targetPiece.side !== activeSide) {
        clipboard = { type: targetPiece.type, side: targetPiece.side, promoted: targetPiece.promoted ?? false };
        editorPanel._setClipboard(clipboard);
      }
      state.board[r][c] = {
        id: crypto.randomUUID(),
        type: activeType,
        side: activeSide,
        promoted: pendingPromote,
        locked: false,
      };
      clearSelection();
      render();
      return;
    }

    // Clicking a piece in Place mode shows its possible moves
    // ES: Hacer clic en una pieza en modo Place muestra sus movimientos posibles
    if (targetPiece) {
      state.selected = { r, c };
      // Use skipKingCheck: true so it works even if there's no king on the board
      // ES: Usa skipKingCheck: true para que funcione aunque no haya rey en el tablero
      state.legalMoves = getLegalMovesForSquare(state, r, c, { skipKingCheck: true });
      updateStatus(`Selected ${targetPiece.type} (${targetPiece.side}) — ${state.legalMoves.length} possible moves`);
      render();
    }
  }, true);
}

export function toggleEditor() {
  editorMode = !editorMode;
  V.editorActive = editorMode;
  if (!editorPanel) createEditorPanel();
  if (editorMode) {
    editorPanel.style.display = 'block';
    messageBar.textContent = '🎨 Edit Mode: Click board to place/erase pieces. Click a piece to see its moves.';
    messageBar.classList.remove('hidden');
    clearSelection();
    hookBoardForEditor();
  } else {
    editorPanel.style.display = 'none';
    messageBar.textContent = '';
    messageBar.classList.add('hidden');
  }
  render();
}

export function isEditorActive() { return editorMode; }

export function ensureEditorHooks() {
  const editBtn = document.getElementById('editModeBtn');
  if (editBtn && !editBtn._hooked) {
    editBtn._hooked = true;
    editBtn.addEventListener('click', toggleEditor);
  }

  const toolsBtn = document.getElementById('devToolsBtn');
  if (toolsBtn && !toolsBtn._hooked) {
    toolsBtn._hooked = true;
    import('../../engine/tools/tools-panel.js').then(m => {
      toolsBtn.addEventListener('click', m.togglePanel);
    });
  }
}