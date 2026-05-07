import { SIDE, BOARD_SIZE } from "../constants.js";
import { isKingInCheck } from "../rules/check.js";
import { applyMove, afterMoveEvaluation, executeDrop, isPromotionAvailableForMove, resetGame } from "../rules/index.js";
import { state, V, COLS, cloneStateForBot, cancelBotTimer, clearSelection } from "../state.js";
import { moveTimeline, loadGameBtn, loadGameInput, messageBar } from "../state.js";

// These are imported from gameplay.js (circular in ES modules is fine for function-level usage)
import { render } from "./gameplay.js";

// ── Timeline (chess.com-like) ────────────────────────────────────────────────

export function snapshotForTimeline() {
  const snap = cloneStateForBot(state);
  snap.selected = null;
  snap.legalMoves = [];
  // Keep message/status to show what the user saw at that ply
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
  // Board
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = src.board[r][c];
      state.board[r][c] = p ? { ...p } : null;
    }
  }
  // Reserves
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

  moveTimeline.appendChild(mkBtn("⏮ Inicio", 0, V.viewPly === 0));
  for (let ply = 1; ply <= V.currentGameNotation.length; ply++) {
    const moveNo = Math.ceil(ply / 2);
    const sideTag = (ply % 2 === 1) ? `${moveNo}.` : `${moveNo}...`;
    moveTimeline.appendChild(mkBtn(`${sideTag} ${V.currentGameNotation[ply - 1]}`, ply, ply === V.viewPly));
  }
}

export function goToPly(ply) {
  const entry = V.timelineSnapshots?.[ply];
  // Even if we don't have a snapshot (e.g. loaded game with unknown moveKeyStr),
  // still allow the UI cursor to move through the timeline.
  if (entry) restoreFromTimelineSnapshot(entry);
  V.viewPly = ply;
  render();
  // scroll to show active button
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
  if (end && !note.endsWith(end)) note += end;
  // Check marker (avoid conflict with existing promotion '+')
  if (!end && state.status === 'playing') {
    try {
      if (isKingInCheck(state, state.turn) && !note.endsWith('%')) note += '%';
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
  if (!obj || obj.version !== 1 || !Array.isArray(obj.snapshots)) throw new Error("Formato inválido.");
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

// Expose manual export for the user (paste into a file if needed)
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
        // Load the server-saved game format: { moves: [{ moveKeyStr, notation, ... }] }
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

        // Build snapshots by replaying moves deterministically from moveKeyStr.
        for (let i = 0; i < obj.moves.length; i++) {
          const mk = obj.moves[i]?.moveKeyStr;
          const mv = parseMoveKeyStr(mk);
          if (!mv) break;
          if (mv.fromReserve) {
            // Best-effort: reserveIndex is order-dependent; if it fails, stop building snapshots.
            const ok = executeDrop(state, mv.reserveIndex, mv.to);
            if (!ok) break;
          } else {
            applyMove(state, mv);
          }
          afterMoveEvaluation(state);
          V.totalMoves = i + 1;
          recordTimelineSnapshot();
          if (state.status !== "playing") {
            // keep going snapshots if file includes longer, but state is terminal; stop to avoid divergence
            break;
          }
        }
        // Restore to final ply we managed to reconstruct
        goToPly(V.totalMoves);
      } else {
        throw new Error("Formato no reconocido.");
      }
      state.message = "Partida cargada.";
      render();
    } catch (e) {
      console.error(e);
      state.message = "No se pudo cargar (JSON inválido o formato incorrecto).";
      render();
    } finally {
      loadGameInput.value = "";
    }
  });
}

// Make wheel scroll move the timeline, not the whole page.
if (moveTimeline) {
  moveTimeline.addEventListener("wheel", (e) => {
    // Always keep scroll inside the timeline when pointer is over it.
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    moveTimeline.scrollLeft += delta;
  }, { passive: false });
}