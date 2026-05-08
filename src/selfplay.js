// src/selfplay.js
import {
  createGame, getAllLegalMoves, applyMove, executeDrop,
  isPromotionAvailableForMove, afterMoveEvaluation,
  isKingInCheck, executeArcherAmbush,
  isPalaceCursedFor, getPalaceInvaders,
} from './rules/index.js';
import {
  isPromotableType, SIDE, opponent, isPalaceSquare, BOARD_SIZE,
  forwardDir,
} from './constants.js';
import {
  chooseBotMove, evaluate, computeFullHash,
  extractFeatures, moveKey, adaptiveMemory,
} from './ai/index.js';
import crypto from 'crypto';

/* ─── Codificación para NNUE (sin cambios) NNUE encoding (no changes) ─── */
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

/* ─── Valores de pieza Piece value ─── */
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

  // ── Caso arquero con emboscada Archer with ambush──
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

  // ── Notación normal Normal notation──
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
    // Insert status suffix before any existing & suffix (palace curse notation)
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

/* ─── Clonar estado mínimamente para el bot Clone minimal state for the bot ─── */
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
    turn:        state.turn,
    reserves: {
      white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
      black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id })),
    },
    palaceTaken:  { white: state.palaceTaken.white,  black: state.palaceTaken.black  },
    palaceTimers: {
      white: { ...state.palaceTimers.white },
      black: { ...state.palaceTimers.black },
    },
    palaceCurse: state.palaceCurse ? {
      white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
      black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
    } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
    lastMove:           state.lastMove ? { ...state.lastMove } : null,
    lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
    repeatMoveCount:    state.repeatMoveCount ?? 0,
    history:            state.history ? [...state.history] : [],
    positionHistory:    state.positionHistory instanceof Map
                          ? new Map(state.positionHistory)
                          : new Map(),
    status:   state.status,
    selected: null,
    legalMoves: [],
    message: '',
  };
}

/* ─── Diversidad en apertura Opening diversity ─── */
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
  const PROMO_SYMBOLS = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  let suffix = '';
  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const curse = state.palaceCurse?.[side];
    if (curse?.justActivated && curse.curseActivators) {
      const parts = [];
      for (const act of curse.curseActivators) {
        const sym = act.promoted
          // DESPUÉS
          ? (PROMO_SYMBOLS[act.type] ?? SYMS[act.type] ?? '?')
          : (SYMS[act.type] || '?');
        const loc = `${COLS[act.c]}${13 - act.r}`;
        parts.push(`${sym}${loc}`);
      }
      if (parts.length > 0) {
        suffix += '&' + parts.join('&') + '-';
      }
    }
  }
  return suffix || '';
}

function boardSnapshot(board) {
  const snap = new Array(169);
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      snap[r * 13 + c] = p ? { t: p.type[0] + p.side[0], promoted: p.promoted ? 1 : 0 } : null;
    }
  }
  return snap;
}

/* ─── FUNCIÓN PRINCIPAL Main function ─── */
export async function playSelfPlayGame(botParams) {
  const state = createGame();
  const moves  = [];
  const MAX_MOVES = 800;

  while (state.status === 'playing' && moves.length < MAX_MOVES) {
    const side = state.turn;
    const currentHash = computeFullHash(state);

    const legalMoves = getAllLegalMoves(state, side);
    if (legalMoves.length === 0) {
      break;
    }

    const stateCopy = cloneStateForBot(state);
    const { move: botMove } = chooseBotMove(stateCopy, botParams);

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

    if (!move || (moves.length < 8 && Math.random() < 0.25)) {
      move = pickOpeningMove(legalMoves, state);
    }
    if (!move) move = legalMoves[0];

    let shouldProm = false;
    let movingPiece = null;
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
    const snap = boardSnapshot(state.board);

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
    const note = notation(state, move, shouldProm, ambushInfo, movingPiece, capturedPiece) + curseSuffix;

    const newHash    = computeFullHash(state);
    const evalResult = evaluate(state, newHash);
    const nnEncoding = encodeBoardForNN(state.board);

    moves.push({
      side,
      moveKeyStr:    moveKey(move),
      featureKey:    extractFeatures(state, side),
      evalBefore,
      evalAfter:     evalResult.score,
      metrics:       evalResult.metrics,
      notation:      note,
      positionHash:  newHash.toString(),
      _nnFloat32:    nnEncoding,
      boardSnapshot: snap,
    });

    // Mark check/draw/mate symbols on the move that just happened.
    markLastMoveNotation(moves, state);

    if (state.status !== 'playing') break;
  }

  if (state.status === 'playing' && moves.length >= MAX_MOVES) {
    state.status = 'draw_move_limit';
    state.message = 'Draw by movement limit (600 moves).';
    // Add end marker to last move.
    markLastMoveNotation(moves, state);
  }

  const finalMessage = state.message || 'Game ended';

  if (state.status !== 'checkmate' && state.status !== 'palacemate') {
    adaptiveMemory.recordDrawGame(moves, state.status);
  }

  const serializedMoves = moves.map(m => ({
    side:          m.side,
    moveKeyStr:    m.moveKeyStr,
    featureKey:    m.featureKey,
    evalBefore:    m.evalBefore,
    evalAfter:     m.evalAfter,
    metrics:       m.metrics,
    notation:      m.notation,
    positionHash:  m.positionHash,
    boardSnapshot: m.boardSnapshot,
    _nnFloat32:    m._nnFloat32 ? Array.from(m._nnFloat32) : undefined,
  }));

  console.log(`Partida: ${finalMessage} (${moves.length} mov)`);
  return {
    moves:        serializedMoves,
    finalStatus:  state.status,
    finalMessage,
  };
}