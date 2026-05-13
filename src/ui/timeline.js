import { SIDE, BOARD_SIZE, isReserveType } from "../../engine/constants.js";
import { isKingInCheck } from "../../engine/rules/check.js";
import { applyMove, afterMoveEvaluation, executeDrop, isPromotionAvailableForMove, resetGame, executeArcherAmbush } from "../../engine/rules/index.js";
import { state, V, COLS, cloneStateForBot, cancelBotTimer, clearSelection, moveTimeline, loadGameBtn, loadGameInput, messageBar } from "../../engine/state.js";

import { render } from "./gameplay.js";

// ---------- Helper para mover piezas a la reserva (igual que en core.js) ----------
// ES: ---------- Helper para mover piezas a la reserva (igual que en core.js) ----------
function captureToReserve(st, piece, captorSide) {
  if (!piece) return;
  const type = piece.promoted ? (piece.type === "pawn" ? "crossbow" : piece.type) : piece.type;
  if (type === 'tower' || type === 'general' || type === 'pawn' || type === 'crossbow') {
    st.reserves[captorSide].push({ id: crypto.randomUUID(), type, side: captorSide });
  }
}

// ---------- Restaurar estado desde representación serializada ----------
function restoreStateFromSerialized(gameState, serialized) {
  const { board, turn, reserves, status, message } = serialized;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      gameState.board[r][c] = p ? { ...p, id: crypto.randomUUID() } : null;
    }
  }
  gameState.turn = turn;
  gameState.reserves.white = reserves.white.map(p => ({ ...p, id: crypto.randomUUID() }));
  gameState.reserves.black = reserves.black.map(p => ({ ...p, id: crypto.randomUUID() }));
  gameState.status = status || 'playing';
  gameState.message = message || '';
}

// ---------- Timeline Snapshot ----------
// ES: ---------- Timeline Snapshot ----------
export function snapshotForTimeline() {
  const snap = cloneStateForBot(state);
  snap.selected = null;
  snap.legalMoves = [];
  snap.status = state.status;
  snap.message = state.message;
  snap.promotionRequest = state.promotionRequest ?? null;
  snap.archerAmbush = null;
  return {
    totalMoves: V.totalMoves,
    notation: [...V.currentGameNotation],
    state: snap,
  };
}

export function restoreFromTimelineSnapshot(entry) {
  if (!entry?.state) return;
  cancelBotTimer();
  clearSelection();

  const src = entry.state;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = src.board[r][c];
      state.board[r][c] = p ? { ...p } : null;
    }
  }
  state.reserves.white = src.reserves.white.map(p => ({ ...p }));
  state.reserves.black = src.reserves.black.map(p => ({ ...p }));

  state.turn = src.turn;
  state.status = src.status;
  state.message = src.message ?? '';
  state.palaceTimers = {
    white: { ...src.palaceTimers?.white },
    black: { ...src.palaceTimers?.black },
  };
  state.palaceTaken = { ...src.palaceTaken };
  state.palaceCurse = src.palaceCurse ? {
    white: { ...src.palaceCurse.white },
    black: { ...src.palaceCurse.black },
  } : null;
  state.lastMove = src.lastMove ? { ...src.lastMove } : null;
  state.lastRepeatedMoveKey = src.lastRepeatedMoveKey ?? null;
  state.repeatMoveCount = src.repeatMoveCount ?? 0;
  state.positionHistory = src.positionHistory instanceof Map ? new Map(src.positionHistory) : new Map();
  state.history = src.history ? [...src.history] : [];
  state.promotionRequest = null;
  state.archerAmbush = null;
}

export function recordTimelineSnapshot() {
  V.timelineSnapshots[V.totalMoves] = snapshotForTimeline();
  V.viewPly = V.totalMoves;
}

export function renderTimeline() {
  if (!moveTimeline) return;
  moveTimeline.innerHTML = "";

  const mkBtn = (label, ply, active = false) => {
    const b = document.createElement("button");
    b.className = "plyBtn" + (active ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", () => goToPly(ply));
    return b;
  };

  const mkWrapper = (label, ply, active = false) => {
    const w = document.createElement("span");
    w.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    const num = document.createElement("span");
    num.style.cssText = "font-size:11px;color:var(--muted);font-weight:600;min-width:18px;text-align:right;user-select:none;";
    num.textContent = ply + ".";
    w.appendChild(num);
    w.appendChild(mkBtn(label, ply, active));
    return w;
  };

  moveTimeline.appendChild(mkBtn("⏮ Start", 0, V.viewPly === 0));
  const totalPlies = Math.max(V.currentGameNotation.length, V.totalMoves);
  for (let ply = 1; ply <= totalPlies; ply++) {
    const nota = V.currentGameNotation[ply - 1] ?? '?';
    moveTimeline.appendChild(mkWrapper(nota, ply, V.viewPly === ply));
  }
}

export function goToPly(ply) {
  const entry = V.timelineSnapshots?.[ply];
  if (entry) restoreFromTimelineSnapshot(entry);
  V.viewPly = ply;
  render();
  const active = moveTimeline?.querySelector(".plyBtn.active");
  active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function terminalSuffixForStatus(status, message = '') {
  if (!status) return '';
  if (status === 'draw_move_limit') return "/";
  if (status === 'draw_agreement') return '==';
  if (status === 'draw') return '=';
  if (status === 'stalemate') return '^';
  if (status === 'palacemate') return '##';
  if (status === 'checkmate') return '#';
  if (status === 'draw' && /acuerdo|agreement/i.test(message)) return '==';
  return '';
}

export function markLastNotationForCurrentState() {
  if (!V.currentGameNotation.length) return;
  let note = V.currentGameNotation[V.currentGameNotation.length - 1] ?? '';
  const end = terminalSuffixForStatus(state.status, state.message);
  if (end && !note.endsWith(end)) {
    // Insert status suffix before any existing & suffix (palace curse notation)
    // ES: Insert status suffix before any existing & suffix (palace curse notation)
    const idx = note.indexOf('&');
    if (idx >= 0 && !note.includes(end)) {
      note = note.slice(0, idx) + end + note.slice(idx);
    } else {
      note += end;
    }
  }
  if (!end && state.status === 'playing') {
    try {
      if (isKingInCheck(state, state.turn)) {
        // Insert % before any existing & suffix (palace curse notation)
        // ES: Insert % before any existing & suffix (palace curse notation)
        const idx = note.indexOf('&');
        if (idx >= 0 && !note.includes('%')) {
          note = note.slice(0, idx) + '%' + note.slice(idx);
        } else if (!note.endsWith('%')) {
          note += '%';
        }
      }
    } catch {}
  }
  V.currentGameNotation[V.currentGameNotation.length - 1] = note;
}

function serializeTimeline() {
  const out = {
    version: 1,
    snapshots: V.timelineSnapshots.map(s => {
      if (!s) return null;
      const st = s.state;
      return {
        totalMoves: s.totalMoves,
        notation: s.notation,
        state: {
          ...st,
          positionHistory: st.positionHistory instanceof Map ? [...st.positionHistory.entries()] : [],
        },
      };
    }),
  };
  return out;
}

function loadTimelineFromObject(obj) {
  if (!obj || obj.version !== 1 || !Array.isArray(obj.snapshots)) throw new Error("Invalid format.");
  V.timelineSnapshots = obj.snapshots.map(s => {
    if (!s?.state) return null;
    const st = { ...s.state };
    st.positionHistory = new Map(st.positionHistory ?? []);
    return { totalMoves: s.totalMoves ?? 0, notation: s.notation ?? [], state: st };
  });
  const last = V.timelineSnapshots.length - 1;
  const lastIdx = last >= 0 ? last : 0;
  const finalEntry = V.timelineSnapshots[lastIdx];
  if (finalEntry) {
    restoreFromTimelineSnapshot(finalEntry);
    V.totalMoves = (finalEntry.notation?.length ?? finalEntry.totalMoves ?? lastIdx) | 0;
    V.currentGameNotation = [...(finalEntry.notation ?? [])];
    V.viewPly = V.totalMoves;
  }
}

window.exportTimelineGame = () => serializeTimeline();

if (loadGameBtn && loadGameInput) {
  loadGameBtn.addEventListener("click", () => loadGameInput.click());
  loadGameInput.addEventListener("change", async () => {
    const file = loadGameInput.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      if (obj?.version === 1 && Array.isArray(obj?.snapshots)) {
        loadTimelineFromObject(obj);
      } else if (Array.isArray(obj?.moves)) {
        // Quitar campos pesados para la visualización
        obj.moves = obj.moves.map(m => {
          const { _nnFloat32, boardSnapshot, ...rest } = m;
          return rest;
        });

        // Si el primer movimiento tiene stateAfter, usamos ese método (rápido y fiable)
        const hasStateAfter = obj.moves.length > 0 && obj.moves[0].stateAfter;
        if (hasStateAfter) {
          resetGame(state);
          clearSelection();
          V.currentGameNotation = obj.moves.map(m => m?.notation ?? '?');
          V.totalMoves = 0;
          V.viewPly = 0;
          V.timelineSnapshots = [];
          recordTimelineSnapshot(); // snapshot inicial (tablero inicial)

          for (let i = 0; i < obj.moves.length; i++) {
            const st = obj.moves[i].stateAfter;
            if (!st) break;
            restoreStateFromSerialized(state, st);
            V.totalMoves = i + 1;
            recordTimelineSnapshot();
            if (st.status && st.status !== 'playing') break;
          }
          V.viewPly = V.totalMoves;
          // Trim notation to match actually loaded moves-only
          // ES: Trim notation to match actually loaded moves-only
          V.currentGameNotation.length = V.totalMoves;
          goToPly(V.totalMoves);
        } else {
          // Fallback: repetición tradicional para partidas antiguas sin stateAfter
          resetGame(state);
          clearSelection();
          V.currentGameNotation = obj.moves.map(m => m?.notation ?? '?');
          V.totalMoves = 0;
          V.viewPly = 0;
          V.timelineSnapshots = [];
          recordTimelineSnapshot();

          const parseMoveKeyStr = (s) => {
            if (typeof s !== 'string') return null;
            if (s.startsWith('M:')) {
              const m = s.match(/^M:(\d+),(\d+)->(\d+),(\d+):p([01])$/);
              if (!m) return null;
              return {
                from: { r: Number(m[1]), c: Number(m[2]) },
                to: { r: Number(m[3]), c: Number(m[4]) },
                promotion: m[5] === '1',
              };
            }
            if (s.startsWith('R:')) {
              const m = s.match(/^R:(\d+)->(\d+),(\d+)$/);
              if (!m) return null;
              return { fromReserve: true, reserveIndex: Number(m[1]), to: { r: Number(m[2]), c: Number(m[3]) }, promotion: false };
            }
            return null;
          };

          for (let i = 0; i < obj.moves.length; i++) {
            const mk = obj.moves[i]?.moveKeyStr;
            const mv = parseMoveKeyStr(mk);
            if (!mv) break;

            if (mv.fromReserve) {
              const ok = executeDrop(state, mv.reserveIndex, mv.to);
              if (!ok) break;
            } else {
              applyMove(state, mv);

              if (state.archerAmbush) {
                const ambush = state.archerAmbush;
                state.archerAmbush = null;
                const captor = state.board[ambush.archerTo.r][ambush.archerTo.c];
                const captorSide = captor?.side;

                if (ambush.type === 'chooseCapture') {
                  executeArcherAmbush(state, { archerTo: ambush.archerTo, chosenIndex: 0 });
                } else {
                  const victims = ambush.type === 'autoCaptureAll' ? ambush.victims : [ambush.victim];
                  for (const v of victims) {
                    const piece = state.board[v.r]?.[v.c];
                    if (piece && captorSide) {
                      captureToReserve(state, piece, captorSide);
                      state.board[v.r][v.c] = null;
                    }
                  }
                }
              }
            }

            afterMoveEvaluation(state);
            V.totalMoves = i + 1;
            recordTimelineSnapshot();
            if (state.status !== "playing") break;
          }
          // Trim notation to match actually loaded moves-only
          // ES: Trim notation to match actually loaded moves-only
          V.currentGameNotation.length = V.totalMoves;
          goToPly(V.totalMoves);
        }
      } else {
        throw new Error("Format not recognized.");
      }
      state.message = "Game loaded.";
      render();
    } catch (e) {
      console.error(e);
      state.message = "Could not load game (invalid JSON or incorrect format).";
      render();
    } finally {
      loadGameInput.value = "";
    }
  });
}

if (moveTimeline) {
  moveTimeline.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    moveTimeline.scrollLeft += delta;
  }, { passive: false });
}

// ══════════════════════════════════════════
//  EXPORT / SHARE SYSTEM
// ES: EXPORT / SHARE SYSTEM
// ══════════════════════════════════════════

/* ── Helpers ── */
function notationText() {
  if (!V.currentGameNotation?.length) return null;
  // Formato estilo ajedrez: "1. e4 e5  2. Nf3 Nc6 ..."
  // ES: Formato estilo ajedrez: "1. e4 e5  2. Nf3 Nc6 ..."
  const lines = [];
  for (let i = 0; i < V.currentGameNotation.length; i += 2) {
    const num  = Math.floor(i / 2) + 1;
    const white = V.currentGameNotation[i]     ?? '';
    const black = V.currentGameNotation[i + 1] ?? '';
    lines.push(`${num}. ${white}${black ? '  ' + black : ''}`);
  }
  return lines.join('\n');
}

function exportJSON() {
  // JSON compacto: solo notación + stateAfter de cada snapshot
  const snaps = V.timelineSnapshots ?? [];
  const moves = snaps.slice(1).map((s, i) => ({
    move:  i + 1,
    nota:  V.currentGameNotation?.[i] ?? '?',
    state: s ? {
      board:    s.state.board.map(row =>
        row.map(p => p ? `${p.type[0]}${p.side[0]}${p.promoted ? '+' : ''}` : null)
      ),
      turn:     s.state.turn,
      reserves: {
        white: s.state.reserves.white.map(p => p.type),
        black: s.state.reserves.black.map(p => p.type),
      },
      status:  s.state.status,
    } : null,
  }));
  return {
    version:  2,
    date:     new Date().toISOString(),
    total:    V.totalMoves,
    status:   state.status,
    notation: V.currentGameNotation ?? [],
    moves,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportAsTXT() {
  const nota = notationText();
  if (!nota) { alert('No moves to export.'); return; }
  const header = [
    `13×13 Game – ${new Date().toLocaleString()}`,
    `Result: ${state.status}   Moves: ${V.totalMoves}`,
    '─'.repeat(48),
    '',
  ].join('\n');
  const blob = new Blob([header + nota], { type: 'text/plain' });
  downloadBlob(blob, `game_${Date.now()}.txt`);
}

function exportAsJSONFile() {
  const data = exportJSON();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `game_${Date.now()}.json`);
}

function exportAsPGN() {
  // Pseudo-PGN adaptado (el formato real es para ajedrez, aquí lo adaptamos)
  const date = new Date();
  const dd   = String(date.getDate()).padStart(2,'0');
  const mm   = String(date.getMonth()+1).padStart(2,'0');
  const yyyy = date.getFullYear();

  let result = '*';
  if (state.status === 'checkmate' || state.status === 'palacemate') {
    // el bando que NO tiene turno ganó
    result = state.turn === 'white' ? '0-1' : '1-0';
  } else if (state.status !== 'playing') {
    result = '1/2-1/2';
  }

  const tags = [
    `[Event "Local Game"]`,
    `[Date "${yyyy}.${mm}.${dd}"]`,
    `[White "White"]`,
    `[Black "Black"]`,
    `[Result "${result}"]`,
    `[Variant "13x13"]`,
    '',
  ].join('\n');

  const nota = notationText() ?? '';
  const blob = new Blob([tags + nota + (nota ? '\n' : '') + result + '\n'],
    { type: 'text/plain' });
  downloadBlob(blob, `game_${Date.now()}.pgn`);
}

async function exportAsPNG() {
  if (!V.currentGameNotation?.length) { alert('No moves to export.'); return; }

  const nota  = V.currentGameNotation ?? [];
  const W     = 680, PAD = 32, LINE_H = 22, HEADER_H = 90;
  const cols  = 2, COL_W = (W - PAD * 2) / cols;
  const rows  = Math.ceil(nota.length / 2);
  const H     = HEADER_H + rows * LINE_H + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;          // HiDPI x2
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // Fondo
  // ES: Fondo
  ctx.fillStyle = '#13171f';
  ctx.fillRect(0, 0, W, H);

  // Borde sutil
  // ES: Borde sutil
  ctx.strokeStyle = '#2d3442';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Header
  // ES: Header
  ctx.fillStyle = '#f3f6fb';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('13×13 Game', PAD, PAD + 20);

  ctx.fillStyle = '#aab3c2';
  ctx.font = '12px monospace';
  ctx.fillText(`${new Date().toLocaleString()}   ·   ${V.totalMoves} moves   ·   ${state.status}`, PAD, PAD + 40);

  // Línea divisoria
  ctx.strokeStyle = '#2d3442';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, HEADER_H - 10); ctx.lineTo(W - PAD, HEADER_H - 10); ctx.stroke();

  // Movimientos en dos columnas
  // ES: Movimientos en dos columnas
  ctx.font = '12px monospace';
  for (let i = 0; i < nota.length; i += 2) {
    const pair = Math.floor(i / 2);
    const col  = 0;                                      // ambos en col izquierda/derecha
    const x    = PAD;
    const y    = HEADER_H + pair * LINE_H + 14;

    // Número
    ctx.fillStyle = '#4a5568';
    ctx.fillText(`${pair + 1}.`, x, y);

    // Blanca
    // ES: Blanca
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(nota[i] ?? '', x + 34, y);

    // Negra
    // ES: Negra
    if (nota[i + 1]) {
      ctx.fillStyle = '#aab3c2';
      ctx.fillText(nota[i + 1], x + COL_W, y);
    }
  }

  // Footer
  // ES: Footer
  ctx.fillStyle = '#2d3442';
  ctx.font = '10px monospace';
  ctx.fillText('13×13 Chess Variant', PAD, H - 10);

  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, `game_${Date.now()}.png`);
  }, 'image/png');
}

/* ── Popup DOM ── */
function buildExportPopup() {
  if (document.getElementById('exportPopup')) return;

  const overlay = document.createElement('div');
  overlay.id = 'exportPopup';
  overlay.className = 'exportPopup hidden';
  overlay.innerHTML = `
    <div class="exportCard">
      <h3>Export game</h3>
      <p>Choose the format you want to download.</p>
      <div class="exportGrid">
        <button class="exportBtn" id="exp-png">
          <span class="eIcon">🖼</span>
          <span class="eLabel">PNG</span>
          <span class="eDesc">Image with full move list, ready to share</span>
        </button>
        <button class="exportBtn" id="exp-txt">
          <span class="eIcon">📄</span>
          <span class="eLabel">TXT</span>
          <span class="eDesc">Plain text notation, chess-style pairs</span>
        </button>
        <button class="exportBtn" id="exp-pgn">
          <span class="eIcon">♟</span>
          <span class="eLabel">PGN</span>
          <span class="eDesc">Standard notation file (compatible with chess tools)</span>
        </button>
        <button class="exportBtn" id="exp-json">
          <span class="eIcon">{ }</span>
          <span class="eLabel">JSON</span>
          <span class="eDesc">Compact: notation + board snapshots per move</span>
        </button>
      </div>
      <button class="exportClose" id="exp-close">✕ Close</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cerrar al hacer click fuera de la card
  // ES: Cerrar al hacer click fuera de la card
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeExportPopup();
  });

  document.getElementById('exp-close').addEventListener('click', closeExportPopup);
  document.getElementById('exp-png').addEventListener('click',  () => { exportAsPNG();      closeExportPopup(); });
  document.getElementById('exp-txt').addEventListener('click',  () => { exportAsTXT();      closeExportPopup(); });
  document.getElementById('exp-pgn').addEventListener('click',  () => { exportAsPGN();      closeExportPopup(); });
  document.getElementById('exp-json').addEventListener('click', () => { exportAsJSONFile(); closeExportPopup(); });
}

function openExportPopup()  {
  buildExportPopup();
  document.getElementById('exportPopup').classList.remove('hidden');
}
function closeExportPopup() {
  document.getElementById('exportPopup')?.classList.add('hidden');
}

/* ── Navigation buttons ── */
function goToFirst() { goToPly(0); }
function goToPrev() { goToPly(Math.max(0, V.viewPly - 1)); }
function goToNext() { goToPly(Math.min(V.totalMoves, V.viewPly + 1)); }
function goToLast() { goToPly(V.totalMoves); }

const navFirstBtn = document.getElementById('navFirstBtn');
const navPrevBtn  = document.getElementById('navPrevBtn');
const navNextBtn  = document.getElementById('navNextBtn');
const navLastBtn  = document.getElementById('navLastBtn');

if (navFirstBtn) navFirstBtn.addEventListener('click', goToFirst);
if (navPrevBtn)  navPrevBtn.addEventListener('click',  goToPrev);
if (navNextBtn)  navNextBtn.addEventListener('click',  goToNext);
if (navLastBtn)  navLastBtn.addEventListener('click',  goToLast);

/* ── Conectar botón ── */
const shareBtn = document.getElementById('shareBtn');
if (shareBtn) {
  shareBtn.addEventListener('click', openExportPopup);
}
