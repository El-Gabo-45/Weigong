// src/selfplay.js
import {
  createGame, getAllLegalMoves, applyMove, executeDrop,
  isPromotionAvailableForMove, afterMoveEvaluation,
  isKingInCheck, executeArcherAmbush,
  isPalaceCursedFor, getPalaceInvaders,
} from '../rules/index.js';
import {
  isPromotableType, SIDE, opponent, isPalaceSquare, BOARD_SIZE,
  forwardDir,
} from '../constants.js';
import {
  chooseBotMove, evaluate, computeFullHash,
  extractFeatures, moveKey, adaptiveMemory,
} from '../ai/index.js';
import { fastCloneState, PackedBoard } from '../ai/packed-state.js';
import crypto from 'crypto';

// ── NN prediction import opcional (solo server‑side) ──
// ES: Import opcional de predicción NN (solo server-side)
let nnPredictScore = null;
try {
  const nnModule = await import('./nn-bridge.js');
  nnPredictScore = nnModule.predictScore;
} catch {
  // No NN available — that's fine, self-play works without it
}

/* ─── Codificación para NNUE ─── */
const PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
};
const NN_CHANNELS = 24;
const NN_SIZE     = BOARD_SIZE * BOARD_SIZE * NN_CHANNELS;

function encodeBoardForNN(board) {
  const enc = new Float32Array(NN_SIZE);
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) continue;
      const ch = PIECE_CHANNEL[p.type];
      if (ch === undefined) continue;
      const offset = p.side === SIDE.WHITE ? 0 : 12;
      enc[(r * 13 + c) * NN_CHANNELS + offset + ch] = 1.0;
    }
  }
  return enc;
}

function moveKeyUint32(move, promote = false) {
  if (!move) return 0;
  if (move.fromReserve) {
    const reserveIndex = Number.isInteger(move.reserveIndex) ? move.reserveIndex & 0xF : 0;
    const r = move.to?.r ?? 0;
    const c = move.to?.c ?? 0;
    return (((1 << 31) >>> 0) | ((reserveIndex & 0xF) << 24) | ((r & 0xF) << 20) | ((c & 0xF) << 16)) >>> 0;
  }
  const fr = move.from?.r ?? 0;
  const fc = move.from?.c ?? 0;
  const tr = move.to?.r ?? 0;
  const tc = move.to?.c ?? 0;
  const p  = promote ? 1 : 0;
  return (((fr & 0xF) << 28) | ((fc & 0xF) << 24) | ((tr & 0xF) << 20) | ((tc & 0xF) << 16) | ((p & 1) << 15)) >>> 0;
}

async function buildRootNNByMoveKey(state, legalMoves) {
  const map = new Map();
  if (!nnPredictScore || !legalMoves?.length) return map;
  const limited = legalMoves.length > 14 ? legalMoves.slice(0, 14) : legalMoves;
  for (const move of limited) {
    try {
      const next = cloneStateForBot(state);
      if (move.fromReserve) {
        executeDrop(next, move.reserveIndex, move.to);
      } else {
        applyMove(next, { from: move.from, to: move.to, promotion: move.promotion ?? false });
      }
      const enc = encodeBoardForNN(next.board);
      const nn = await nnPredictScore(enc);
      if (typeof nn === 'number' && Number.isFinite(nn)) {
        map.set(moveKeyUint32(move, move.promotion ?? false), nn);
      }
    } catch {}
  }
  return map;
}

/* ─── Valores de pieza ─── */
const PIECE_VALUES = {
  king:0, queen:950, general:560, elephant:240, priest:400,
  horse:320, cannon:450, tower:520, carriage:390, archer:450,
  pawn:110, crossbow:240,
};
const PROMOTED_VALUES = {
  pawn:240, tower:650, horse:430, elephant:320, priest:540, cannon:540,
};
function getPieceValue(p) {
  const base = PIECE_VALUES[p.type] ?? 0;
  return p.promoted ? (PROMOTED_VALUES[p.type] ?? base + 120) : base;
}

const SYMS = {
  king:'K', queen:'Q', general:'G', elephant:'E', priest:'P',
  horse:'H', cannon:'C', tower:'T', carriage:'Ca', archer:'A',
  pawn:'p', crossbow:'B',
};
const COLS = 'ABCDEFGHIJKLM';
const PROMO_SYMBOLS = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };

function notation(state, move, promote = false, ambushInfo = null, originalPiece = null, capturedPiece = null) {
  const toStr = `${COLS[move.to.c]}${13 - move.to.r}`;
  if (move.fromReserve) {
    const droppedPiece = state.board[move.to.r]?.[move.to.c];
    const sym = droppedPiece
        ? (droppedPiece.promoted
            ? (PROMO_SYMBOLS[droppedPiece.type] ?? SYMS[droppedPiece.type])
            : SYMS[droppedPiece.type])
        : '?';
    return `${sym}*${toStr}`;
  }

  const p = originalPiece ?? state.board[move.from.r]?.[move.from.c];
  if (!p) return '?';

  const sym = p.promoted ? (PROMO_SYMBOLS[p.type] ?? SYMS[p.type]) : SYMS[p.type];

  if (p.type === 'archer' && ambushInfo) {
    const options = ambushInfo.options || [];
    if (options.length === 0) return `A${toStr}`;

    const chosen = options[0];
    const chosenSym = chosen.piece.promoted
      ? (PROMO_SYMBOLS[chosen.piece.type] ?? SYMS[chosen.piece.type])
      : SYMS[chosen.piece.type];
    const chosenLoc = `${COLS[chosen.c]}${13 - chosen.r}`;
    let nota = `A${toStr}>${chosenSym}x${chosenLoc}`;

    for (let i = 1; i < options.length; i++) {
      const opt = options[i];
      const symOpt = opt.piece.promoted
        ? (PROMO_SYMBOLS[opt.piece.type] ?? SYMS[opt.piece.type])
        : SYMS[opt.piece.type];
      if (opt.canRetreat) {
        const retreatDir = forwardDir(opponent(state.turn));
        const retreatR = opt.r + retreatDir;
        const retreatC = opt.c;
        const retreatLoc = `${COLS[retreatC]}${13 - retreatR}`;
        nota += `, ${symOpt}${COLS[opt.c]}${13 - opt.r}→${retreatLoc}`;
      } else {
        nota += `, ${symOpt}x${COLS[opt.c]}${13 - opt.r}`;
      }
    }
    return nota;
  }

  const target = capturedPiece;
  let n = sym;
  if (target && target.side !== p.side) {
    const targetSym = target.promoted
      ? (PROMO_SYMBOLS[target.type] ?? SYMS[target.type])
      : SYMS[target.type];
    n += `x${targetSym.toLowerCase()}${toStr}`;
  } else {
    n += toStr;
  }
  if (promote) n += '+';
  return n;
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

function markLastMoveNotation(moves, state) {
  if (!moves || moves.length === 0) return;
  let note = moves[moves.length - 1].notation ?? '';
  const end = terminalSuffixForStatus(state.status, state.message);
  if (end && !note.endsWith(end)) {
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
        const idx = note.indexOf('&');
        if (idx >= 0 && !note.includes('%')) {
          note = note.slice(0, idx) + '%' + note.slice(idx);
        } else if (!note.endsWith('%')) {
          note += '%';
        }
      }
    } catch {}
  }
  moves[moves.length - 1].notation = note;
}

/* ─── Captura a reserva ─── */
function captureToReserve(state, captured, captorSide) {
  if (!captured) return;
  const type = captured.promoted
    ? (captured.type === 'pawn' ? 'crossbow' : captured.type)
    : captured.type;
  if (['tower','general','pawn','crossbow'].includes(type)) {
    state.reserves[captorSide].push({ id: crypto.randomUUID(), type, side: captorSide });
  }
}

function resolveAmbush(ambush, side, state) {
  if (!ambush) return;
  if (ambush.type === 'autoCaptureAll') {
    for (const v of ambush.victims) {
      const victim = state.board[v.r]?.[v.c];
      if (victim) { captureToReserve(state, victim, side); state.board[v.r][v.c] = null; }
    }
  } else if (ambush.type === 'singleCapture') {
    const victim = state.board[ambush.victim.r]?.[ambush.victim.c];
    if (victim) { captureToReserve(state, victim, side); state.board[ambush.victim.r][ambush.victim.c] = null; }
  } else if (ambush.type === 'chooseCapture') {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < ambush.options.length; i++) {
      const opt = ambush.options[i];
      let sc = getPieceValue(opt.piece);
      if (!opt.canRetreat) sc += 80;
      if (isPalaceSquare(opt.r, opt.c, opponent(side))) sc += 120;
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }
    executeArcherAmbush(state, { archerTo: ambush.archerTo, chosenIndex: bestIdx });
  }
}

// ── FIX-6: cloneStateForBot unificado — misma implementación que server.js.
// Incluye todos los campos que el motor necesita (promotionRequest, archerAmbush,
// history, positionHistory). La versión anterior en selfplay.js omitía algunos.
// ES: versión canónica que incluye todos los campos requeridos por el motor.
function cloneStateForBot(state) {
  const board = new Array(13);
  for (let r = 0; r < 13; r++) {
    board[r] = new Array(13);
    for (let c = 0; c < 13; c++) {
      const p = state.board[r][c];
      board[r][c] = p ? { ...p } : null;
    }
  }
  return {
    board,
    turn: state.turn,
    selected: null,
    legalMoves: [],
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
    },
    promotionRequest: null,
    palaceTaken:  { white: state.palaceTaken?.white ?? false, black: state.palaceTaken?.black ?? false },
    palaceTimers: {
      white: { ...state.palaceTimers?.white ?? { pressure: 0, invaded: false, attackerSide: null } },
      black: { ...state.palaceTimers?.black ?? { pressure: 0, invaded: false, attackerSide: null } },
    },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove:            state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount:     state.repeatMoveCount ?? 0,
    history:             state.history ? [...state.history] : [],
    positionHistory:     state.positionHistory instanceof Map
                           ? new Map(state.positionHistory) : new Map(),
    status:      state.status,
    message:     '',
    archerAmbush: null,
  };
}

/* ─── Diversidad en apertura ─── */
function pickOpeningMove(legalMoves, state) {
  const safe = legalMoves.filter(m => {
    if (m.fromReserve) return true;
    const p = state.board[m.from.r]?.[m.from.c];
    if (!p) return false;
    const target = state.board[m.to.r]?.[m.to.c];
    if (target && target.side !== p.side) {
      if (getPieceValue(p) > getPieceValue(target) * 1.5) return false;
    }
    return true;
  });
  const pool = safe.length > 1 ? safe : legalMoves;
  return pool[Math.floor(Math.random() * pool.length)];
}

function appendCurseNotation(state) {
  let suffix = '';
  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const curse = state.palaceCurse?.[side];
    if (curse?.justActivated && curse.curseActivators) {
      const parts = [];
      for (const act of curse.curseActivators) {
        const sym = act.promoted
          ? (PROMO_SYMBOLS[act.type] ?? SYMS[act.type] ?? '?')
          : (SYMS[act.type] || '?');
        const loc = `${COLS[act.c]}${13 - act.r}`;
        parts.push(`${sym}${loc}`);
      }
      if (parts.length > 0) suffix += '&' + parts.join('&') + '-';
    }
  }
  return suffix || '';
}

// ── FIX-8: boardSnapshot compacto — en lugar de 169 objetos {t, promoted} por turno,
// usa un string de 169 × 3 chars (tipo+side+promo) que es mucho más liviano en memoria
// y serialización. El receptor puede parsearlo si necesita hacer diff.
// ES: snapshot compacto en string plano — mucho menos overhead de GC que 169 objetos.
function boardSnapshot(board) {
  let s = '';
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) { s += '...'; continue; }
      // tipo[0] + side[0] + promoted(0/1) — 3 chars por celda, 507 total
      s += p.type[0] + p.side[0] + (p.promoted ? '1' : '0');
    }
  }
  return s;
}

/* ─── Captura el estado mínimo en formato packed (~200 bytes) ─── */
// ES: Estado mínimo en formato packed (~200 bytes) en lugar de ~40KB de objetos
function captureStateAfter(state) {
  return PackedBoard.pack(state);
}

/* ─── FUNCIÓN PRINCIPAL ─── */
export async function playSelfPlayGame(botParams) {
  const state = createGame();
  const moves  = [];
  const MAX_MOVES = 1000;

  while (state.status === 'playing' && moves.length < MAX_MOVES) {
    const side = state.turn;
    const currentHash = computeFullHash(state);

    const legalMoves = getAllLegalMoves(state, side);
    if (legalMoves.length === 0) break;

    const stateCopy = cloneStateForBot(state);
    const rootNNByMoveKey = await buildRootNNByMoveKey(state, legalMoves);
    const { move: botMove } = chooseBotMove(stateCopy, { ...botParams, rootNNByMoveKey });

    let move = null;
    if (botMove) {
      move = legalMoves.find(m => {
        if (botMove.fromReserve && m.fromReserve)
          return m.reserveIndex === botMove.reserveIndex &&
                 m.to.r === botMove.to.r && m.to.c === botMove.to.c;
        if (!botMove.fromReserve && !m.fromReserve && m.from && botMove.from)
          return m.from.r === botMove.from.r && m.from.c === botMove.from.c &&
                 m.to.r === botMove.to.r    && m.to.c === botMove.to.c;
        return false;
      }) ?? null;
    }

    const exploreChance = moves.length < 8  ? 0.5
                        : moves.length < 30 ? 0.15
                        : moves.length < 80 ? 0.05 : 0;

    if (!move || Math.random() < exploreChance) {
      move = pickOpeningMove(legalMoves, state);
    }

    let shouldProm    = false;
    let movingPiece   = null;
    let capturedPiece = null;
    if (!move.fromReserve && move.from && move.to) {
      const piece = state.board[move.from.r]?.[move.from.c];
      movingPiece = piece;
      shouldProm = piece
        && isPromotionAvailableForMove(state, move.from, move.to)
        && isPromotableType(piece.type)
        && !piece.promoted;
      capturedPiece = state.board[move.to.r]?.[move.to.c];
    }

    const evalBefore = evaluate(state, currentHash).score;
    const snap       = boardSnapshot(state.board);

    // ── Aplicar movimiento ──
    if (move.fromReserve) {
      executeDrop(state, move.reserveIndex, move.to);
    } else {
      applyMove(state, { from: move.from, to: move.to, promotion: shouldProm });
    }

    const ambushInfo = state.archerAmbush;
    if (state.archerAmbush) {
      state.archerAmbush = null;
      resolveAmbush(ambushInfo, side, state);
    }

    afterMoveEvaluation(state);

    const curseSuffix = appendCurseNotation(state);
    const note        = notation(state, move, shouldProm, ambushInfo, movingPiece, capturedPiece) + curseSuffix;

    const newHash    = computeFullHash(state);
    const evalResult = evaluate(state, newHash);
    const nnEncoding = encodeBoardForNN(state.board);

    const stateAfter = captureStateAfter(state);
    const moveKeyNum = moveKeyUint32(move, shouldProm);

    moves.push({
      side,
      moveKeyStr:    moveKey(move),
      moveKeyUint32: moveKeyNum,
      featureKey:    extractFeatures(state, side),
      evalBefore,
      evalAfter:     evalResult.score,
      metrics:       evalResult.metrics,
      notation:      note,
      positionHash:  newHash.toString(),
      _nnFloat32:    nnEncoding,
      boardSnapshot: snap,
      stateAfter,
    });

    markLastMoveNotation(moves, state);

    if (state.status !== 'playing') break;
  }

  if (state.status === 'playing' && moves.length >= MAX_MOVES) {
    state.status  = 'draw_move_limit';
    state.message = 'Draw by movement limit (1000 moves).';
    markLastMoveNotation(moves, state);
    if (moves.length > 0) {
      moves[moves.length - 1].stateAfter = captureStateAfter(state);
    }
  }

  const finalMessage = state.message || 'Game ended';

  if (state.status !== 'checkmate' && state.status !== 'palacemate') {
    adaptiveMemory.recordDrawGame(moves, state.status);
  }

  // FIX-11: boardSnapshot (~500 bytes) y stateAfter (~40KB) solo se usan en UI,
  // nunca en aprendizaje o entrenamiento. Evitar serializarlos al worker.
  // ES: omitir datos de UI en serialización para ahorrar ~40MB por partida.
  const serializedMoves = moves.map(m => ({
    side:          m.side,
    moveKeyStr:    m.moveKeyStr,
    featureKey:    m.featureKey,
    evalBefore:    m.evalBefore,
    evalAfter:     m.evalAfter,
    metrics:       m.metrics,
    notation:      m.notation,
    positionHash:  m.positionHash,
    _nnFloat32:    m._nnFloat32 ? Array.from(m._nnFloat32) : undefined,
  }));

  console.log(`Partida: ${finalMessage} (${moves.length} mov)`);
  return {
    moves:        serializedMoves,
    finalStatus:  state.status,
    finalMessage,
  };
}