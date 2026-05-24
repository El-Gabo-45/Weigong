import { dbg } from '../debug/debug.js';
import { SIDE, opponent, isPalaceSquare, onBank, isPromotableType } from '../constants.js';
import { getAllLegalMoves, isKingInCheck, isPromotionAvailableForMove, isSquareAttacked } from '../rules/index.js';
import { computeFullHash, TranspositionTable, ZobristTurn } from './hashing.js';
import { evaluate, gamePhaseFactor, buildAttackMap } from './evaluation.js';
import { makeMove, unmakeMove, isSEEPositive, pieceValue } from './moves.js';
import { adaptiveMemory } from './memory.js';
import { createIncrementalMaps, applyMoveToMaps } from './incremental-attack.js';

const MATE_SCORE = 1_000_000;
const INF        = 1_000_000_000;
const TT_EXACT = 0, TT_ALPHA = 1, TT_BETA = 2;
const FUTILITY_MARGIN = [0, 150, 300, 500];

// Umbral de ventaja mínima para que el bot acepte forzar empate por repetición.
// Si el bot está ganando por más de esto, rechaza repetir.
const DRAW_CONTEMPT = 150;

// ── OPT-4: Quiescence depth limit — prevents search explosion on long capture chains.
// ES: Límite de profundidad en quiescence — previene explosión en cadenas largas de capturas.
const QSEARCH_MAX_DEPTH = 6;

// ── OPT-4: Delta pruning margin in quiescence — if even capturing the best possible
// piece won't bring us within alpha, cut off immediately.
// ES: Margen de delta pruning en quiescence — si ni capturando la mejor pieza alcanzamos alpha, cortar.
const QDELTA_MARGIN = 600;

const killerMoves  = new Map();
const historyTable = { white: new Map(), black: new Map() };
const KILLER_SLOTS = 2;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

class SearchTimeout extends Error {}

const DROP_MOVE_FLAG = 1 << 31;

export function moveKey(move, promote = false) {
  if (!move) return 'null';
  if (move.fromReserve) return `R:${move.reserveIndex}->${move.to.r},${move.to.c}`;
  const promotionFlag = promote ? ':p1' : ':p0';
  return `M:${move.from.r},${move.from.c}->${move.to.r},${move.to.c}${promotionFlag}`;
}

export function moveKeyUint32(move, promote = false) {
  if (!move) return 0;
  if (move.fromReserve) {
    const reserveIndex = Number.isInteger(move.reserveIndex) ? move.reserveIndex & 0xF : 0;
    const r = move.to?.r ?? 0;
    const c = move.to?.c ?? 0;
    return (((DROP_MOVE_FLAG >>> 0) | ((reserveIndex & 0xF) << 24) | ((r & 0xF) << 20) | ((c & 0xF) << 16)) >>> 0);
  }
  const fr = move.from?.r ?? 0;
  const fc = move.from?.c ?? 0;
  const tr = move.to?.r ?? 0;
  const tc = move.to?.c ?? 0;
  const p  = promote ? 1 : 0;
  return (((fr & 0xF) << 28) | ((fc & 0xF) << 24) | ((tr & 0xF) << 20) | ((tc & 0xF) << 16) | ((p & 1) << 15)) >>> 0;
}

function storeKiller(depth, move) {
  const key = moveKeyUint32(move, move.promotion ?? false);
  const prev = killerMoves.get(depth) ?? [];
  if (prev[0] === key) return;
  killerMoves.set(depth, [key, prev[0] ?? null].filter(Boolean).slice(0, KILLER_SLOTS));
}

// Accept pre-computed key to avoid redundant moveKey() calls from moveOrderScore
// ES: Aceptar clave pre-computada para evitar llamadas redundantes a moveKey() desde moveOrderScore
function killerScore(depth, mk) {
  const arr = killerMoves.get(depth);
  if (!arr) return 0;
  return arr[0] === mk ? 900 : arr[1] === mk ? 650 : 0;
}

function historyScore(side, mk) { return historyTable[side].get(mk) ?? 0; }

function storeHistory(side, move, depth) {
  const key = moveKeyUint32(move, move.promotion ?? false);
  historyTable[side].set(key, (historyTable[side].get(key) ?? 0) + depth * depth);
}

// ── OPT-6: Age history table between IDS iterations to prevent stale scores
// from shallow depths dominating ordering at deeper iterations.
// Call this at the start of each new IDS depth iteration in chooseBlackBotMove.
// ES: Decay de la tabla de historia entre iteraciones IDS para que los scores de
// profundidades previas no dominen el ordenamiento en iteraciones más profundas.
export function decayHistoryTable() {
  for (const [k, v] of historyTable.white) historyTable.white.set(k, v >> 1);
  for (const [k, v] of historyTable.black) historyTable.black.set(k, v >> 1);
}

function isQuiet(state, move, promote) {
  return !move || move.fromReserve || promote ? false : !state.board?.[move.to?.r]?.[move.to?.c];
}

// ── OPT-2: terminalScore now accepts a pre-computed legalMoves array to avoid
// calling getAllLegalMoves() a second time when search() already computed them.
// Pass null to fall back to computing internally (used in searchRoot edge case).
// ES: terminalScore acepta moves pre-computados para evitar doble llamada a getAllLegalMoves().
function terminalScore(state, depth, precomputedMoves = null) {
  try {
    const legal = precomputedMoves ?? getAllLegalMoves(state, state.turn) ?? [];
    const inCheck = isKingInCheck(state, state.turn);
    if (legal.length === 0)
      return inCheck ? (state.turn === SIDE.BLACK ? -MATE_SCORE + depth : MATE_SCORE - depth) : 0;
    return null;
  } catch (err) {
    console.error('[terminalScore] Error:', err);
    return null;
  }
}

function isTactical(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return false;
  const moving = state.board?.[move.from.r]?.[move.from.c];
  if (!moving) return false;
  if (state.board?.[move.to.r]?.[move.to.c]) return true;
  return !moving.promoted && isPromotionAvailableForMove(state, move.from, move.to);
}

function givesCheck(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return false;
  const md = makeMove(state, move, false, 0n, null);
  if (!md.action) return false;
  const inCheck = isKingInCheck(state, state.turn);
  unmakeMove(state, md);
  return inCheck;
}

// Counts how many times hash appears in history
// ES: Cuenta cuántas veces aparece hash en el historial
function countRepetitions(history, hash) {
  let seen = 0;
  for (const h of history) if (h === hash) seen++;
  return seen;
}

// ── OPT-1: quiescence now has a depth limit (qdepth) and delta pruning.
// qdepth: counts down from QSEARCH_MAX_DEPTH; when it reaches 0, return static eval.
// delta pruning: if even the best possible capture won't reach alpha, cut immediately.
// ES: quiescence con límite de profundidad y delta pruning.
// qdepth: contador regresivo desde QSEARCH_MAX_DEPTH; cuando llega a 0, retorna eval estática.
// delta pruning: si ni la mejor captura posible alcanza alpha, cortar inmediatamente.
function quiescence(state, alpha, beta, deadline, hash, staticEval = null, qdepth = QSEARCH_MAX_DEPTH) {
  if (now() > deadline) throw new SearchTimeout();
  const maximizing = state.turn === SIDE.BLACK;
  const inCheck    = isKingInCheck(state, state.turn);
    const ev         = staticEval ?? evaluate(state, hash, null, true).score;

  // Hard depth limit — return static eval when qdepth exhausted
  // ES: Límite duro de profundidad — retornar eval estática al agotar qdepth
  if (qdepth <= 0 && !inCheck) return ev;

  let best = inCheck ? (maximizing ? -INF : INF) : ev;
  if (!inCheck) {
    if (maximizing) {
      if (best >= beta) return best;
      alpha = Math.max(alpha, best);
      // OPT-1: Delta pruning — skip search if even capturing the most valuable piece
      // cannot possibly raise alpha by more than QDELTA_MARGIN.
      // ES: Delta pruning — omitir si capturar la pieza más valiosa no puede superar alpha.
      if (ev + QDELTA_MARGIN < alpha) return ev;
    } else {
      if (best <= alpha) return best;
      beta = Math.min(beta, best);
      if (ev - QDELTA_MARGIN > beta) return ev;
    }
  }
  const moves = getAllLegalMoves(state, state.turn)
    .filter(m => m && (inCheck || isTactical(state, m)))
    .sort((a, b) => moveOrderScore(state, b, 0) - moveOrderScore(state, a, 0));
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    if (!inCheck && !move.fromReserve && state.board[move.to?.r]?.[move.to?.c]) {
      if (!isSEEPositive(state, move, buildAttackMap)) continue;
    }
    for (const promote of getBranches(state, move)) {
      const md = makeMove(state, move, promote, hash, best);
      if (!md.action || !md.undo) continue;
      try {
        const score = -quiescence(state, -beta, -alpha, deadline, md.hash,
          md.evalDiff ? -best - md.evalDiff : null, qdepth - 1);
        if (maximizing) {
          if (score > best) best = score;
          alpha = Math.max(alpha, best);
          if (alpha >= beta) return best;
        } else {
          if (score < best) best = score;
          beta = Math.min(beta, best);
          if (alpha >= beta) return best;
        }
      } finally {
        unmakeMove(state, md);
      }
    }
  }
  return best;
}

export function search(state, depth, alpha, beta, deadline, tt, hash,
                       staticEval = null, isNullMove = false) {
  if (now() > deadline) throw new SearchTimeout();

  // Repetition detection inside search
  // ES: Detección de repetición dentro de la búsqueda
  // If this position already appeared in the current search history,
  // return a draw score adjusted by contempt.
  // The bot only accepts the draw if losing; if winning, it rejects it.
  // ES: El bot solo acepta el empate si está perdiendo; si está ganando, lo rechaza.
  if (state.history?.length >= 2) {
    const reps = countRepetitions(state.history, hash);
    if (reps >= 2) {
      // Posición repetida 3 veces → empate forzado
      // Contempt: si el bot (negro) está ganando, el empate vale menos que 0
      const contempt = state.turn === SIDE.BLACK ? -DRAW_CONTEMPT : DRAW_CONTEMPT;
      dbg.search(`repetition draw`, { hash: hash.toString().slice(0, 10), reps });
      return contempt;
    }
    if (reps === 1) {
      // Second time it appears — penalize in static evaluation
      // so the bot looks for alternatives before reaching a third.
      // Scale with depth: deeper nodes get heavier penalty so the bot
      // avoids the repetition path well before reaching the root.
      // ES: Segunda aparición — penalizar eval estática escalando con profundidad
      if (staticEval === null) staticEval = evaluate(state, hash, null, true).score;
      const sign = state.turn === SIDE.BLACK ? 1 : -1;
      staticEval -= sign * (600 + depth * 80);
    }
  }

  const cached = tt.get(hash);
  if (cached && cached.depth >= depth) {
    dbg.search(`TT hit`, {
      flag:  cached.flag === TT_EXACT ? 'EXACT' : cached.flag === TT_ALPHA ? 'ALPHA' : 'BETA',
      score: cached.score, depth,
      hash:  hash.toString().slice(0, 12),
    });
    if (cached.flag === TT_EXACT) return cached.score;
    if (cached.flag === TT_ALPHA && cached.score <= alpha) return alpha;
    if (cached.flag === TT_BETA  && cached.score >= beta)  return beta;
  }

  // OPT-2: Compute rawMoves once here — passed to terminalScore to avoid
  // getAllLegalMoves() being called twice at depth==0 boundary.
  // ES: Calcular rawMoves una sola vez — se pasa a terminalScore para evitar
  // doble llamada a getAllLegalMoves() en la frontera depth==0.
  const rawMoves = getAllLegalMoves(state, state.turn);
  const term = terminalScore(state, depth, rawMoves);
  if (term !== null) return term;
  if (depth <= 0) return quiescence(state, alpha, beta, deadline, hash, staticEval);

  const maximizing = state.turn === SIDE.BLACK;
  const inCheck    = isKingInCheck(state, state.turn);
  if (staticEval === null) staticEval = evaluate(state, hash, null, true).score;

  // Razoring
  // ES: Razoring (poda por evaluación reducida)
  if (!inCheck && depth <= 2) {
    const razorMargin = depth === 1 ? 250 : 450;
    if (maximizing && staticEval + razorMargin <= alpha)
      return quiescence(state, alpha, beta, deadline, hash, staticEval);
    if (!maximizing && staticEval - razorMargin >= beta)
      return quiescence(state, alpha, beta, deadline, hash, staticEval);
  }

  // OPT-3: countMaterial hoisted as module-level function to avoid re-declaring
  // on every search() call (was an inner function definition per node).
  // ES: countMaterial movido a nivel de módulo para evitar re-declaración por nodo.

  const hasDrops    = state.reserves[state.turn].length > 0;
  const curseActive = state.palaceCurse?.[state.turn]?.active;

  // Null move pruning with adaptive R
  // ES: Poda de movimiento nulo con R adaptativo
  // OPT-5: R is now adaptive (depth/3, min 2) instead of fixed 2/3.
  // Larger R at higher depths means fewer nodes at early plies.
  // ES: R adaptativo (depth/3, mín 2) en lugar de fijo. Menos nodos en plies altas.
  if (!isNullMove && depth >= 3 && !inCheck && !hasDrops && !curseActive
      && countMaterial(state.board) > 4) {
    // Use isSquareAttacked (from rules) instead of full buildAttackMap — much faster
    // ES: Usar isSquareAttacked (de rules) en lugar de buildAttackMap completo — mucho más rápido
    let kingAttacked = false;
    for (let r = 0; r < 13 && !kingAttacked; r++)
      for (let c = 0; c < 13 && !kingAttacked; c++) {
        const p = state.board[r][c];
        if (p && p.side === state.turn && p.type === 'king')
          kingAttacked = isSquareAttacked(state.board, r, c, opponent(state.turn), state);
      }
    if (!kingAttacked) {
      const saved = state.turn;
      state.turn  = opponent(saved);
      // OPT-5: Adaptive R — deeper positions use larger reductions.
      // depth 3-4 → R=2, depth 5-7 → R=2 or 3, depth 8+ → R=3+
      // ES: R adaptativo: depth/3 redondeado, mínimo 2.
      const R = Math.max(2, Math.floor(depth / 3));
      const nullScore = -search(state, depth - 1 - R, -beta, -alpha, deadline, tt,
        hash ^ ZobristTurn[0] ^ ZobristTurn[1], staticEval, true);
      state.turn = saved;
      if (maximizing && nullScore >= beta)  return beta;
      if (!maximizing && nullScore <= alpha) return alpha;
    }
  }

  // OPT-7: IIR — Internal Iterative Reduction.
  // If no TT move is available at depth >= 5, reduce depth by 1 to get a quick
  // estimate of the best move before doing the full search. This avoids spending
  // full effort on nodes where move ordering is essentially random.
  // ES: IIR: si no hay TT move en depth>=5, reducir depth-1 para obtener
  // una estimación rápida del mejor movimiento antes de la búsqueda completa.
  const ttMoveKey = cached?.bestMoveKey ?? null;
  let effectiveDepth = depth;
  if (!ttMoveKey && depth >= 5 && !inCheck) {
    effectiveDepth = depth - 1;
  }

  let hashFlag = TT_ALPHA, bestMoveForTT = null;
  // OPT-2: reuse rawMoves computed above — no second call to getAllLegalMoves()
  // ES: Reutilizar rawMoves ya computados — sin segunda llamada a getAllLegalMoves()
  const scoredMoves = [];
  for (let mi = 0; mi < rawMoves.length; mi++) {
    const m = rawMoves[mi];
    if (!m) continue;
    if (!m.fromReserve && !m.from) continue;
    // Pass hash so moveOrderScore doesn't recompute computeFullHash() N times
    // ES: Pasar hash para que moveOrderScore no recalcule computeFullHash() N veces
    const s = moveOrderScore(state, m, depth, hash);
    scoredMoves.push({ move: m, score: ttMoveKey && moveKeyUint32(m, m.promotion) === ttMoveKey ? s + 1_000_000 : s });
  }
  scoredMoves.sort((a, b) => b.score - a.score);
  const moves = [];
  for (let i = 0; i < scoredMoves.length; i++) moves.push(scoredMoves[i].move);

  // OPT-8: ProbCut — fixed to probe tactical (capture) moves with positive SEE,
  // not quiet moves. ProbCut is designed to prune captures that are overwhelmingly
  // likely to exceed beta at a shallower depth; it makes no sense on quiet moves.
  // ES: ProbCut corregido para probar capturas con SEE positivo, no movs quietos.
  // ProbCut sirve para podar capturas que probablemente superan beta en menor profundidad.
  if (effectiveDepth >= 4 && !inCheck && Math.abs(beta) < MATE_SCORE / 2) {
    const probDepth  = effectiveDepth - 4;
    const probMargin = 150;
    for (const move of moves) {
      // OPT-8: Only probe tactical moves (captures/promotions) with positive SEE
      // ES: Solo probar movimientos tácticos (capturas/promociones) con SEE positivo
      if (!isTactical(state, move)) continue;
      if (!move.fromReserve && state.board[move.to?.r]?.[move.to?.c]) {
        if (!isSEEPositive(state, move, buildAttackMap)) continue;
      }
      const md = makeMove(state, move, false, hash, staticEval);
      if (!md.action) continue;
      try {
        const probScore = -search(state, probDepth, -beta - probMargin, -beta + probMargin,
          deadline, tt, md.hash, null, false);
        if (probScore >= beta) {
          tt.set(hash, { depth, score: probScore, flag: TT_BETA,
            bestMoveKey: moveKeyUint32(move, move.promotion) });
          return probScore;
        }
      } finally {
        unmakeMove(state, md);
      }
    }
  }

  let best = maximizing ? -INF : INF, moveCount = 0;
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    if (!inCheck && effectiveDepth <= 3 && staticEval !== null && !move.fromReserve) {
      const margin    = FUTILITY_MARGIN[Math.min(effectiveDepth, 3)];
      const isCapture = !!state.board[move.to?.r]?.[move.to?.c];
      if (!isCapture && !isTactical(state, move)) {
        if (maximizing  && staticEval + margin <= alpha) continue;
        if (!maximizing && staticEval - margin >= beta)  continue;
      }
    }
    for (const promote of getBranches(state, move)) {
      moveCount++;
      const tactical  = isTactical(state, move) || promote;
      const md        = makeMove(state, move, promote, hash, staticEval);
      if (!md.action || !md.undo) continue;
      try {
        let score;
        const childEval = md.evalDiff ? staticEval + md.evalDiff : null;
        if (moveCount === 1) {
          score = -search(state, effectiveDepth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
        } else {
          let reduction = 0;
          if (effectiveDepth >= 3 && moveCount >= 3 && !tactical && !inCheck) {
            reduction = Math.floor(Math.log(effectiveDepth) * Math.log(moveCount) / 2);
            reduction = Math.max(1, Math.min(reduction, effectiveDepth - 2));
          }
          score = -search(state, effectiveDepth - 1 - reduction, -alpha - 1, -alpha, deadline, tt,
            md.hash, childEval, false);
          if (score > alpha && reduction > 0)
            score = -search(state, effectiveDepth - 1, -alpha - 1, -alpha, deadline, tt,
              md.hash, childEval, false);
          if (score > alpha && score < beta)
            score = -search(state, effectiveDepth - 1, -beta, -alpha, deadline, tt,
              md.hash, childEval, false);
        }
        if (maximizing) {
          if (score > best) { best = score; bestMoveForTT = move; }
          if (best > alpha) { alpha = best; hashFlag = TT_EXACT; }
        } else {
          if (score < best) { best = score; bestMoveForTT = move; }
          if (best < beta)  { beta  = best; hashFlag = TT_EXACT; }
        }
        if (alpha >= beta) {
          if (isQuiet(state, move, promote)) {
            storeKiller(depth, move);
            storeHistory(state.turn, move, depth);
          }
          tt.set(hash, { depth, score: best, flag: TT_BETA,
            bestMoveKey: moveKeyUint32(bestMoveForTT || move, (bestMoveForTT || move).promotion) });
          return best;
        }
      } finally {
        unmakeMove(state, md);
      }
    }
  }
  tt.set(hash, { depth, score: best, flag: hashFlag,
    bestMoveKey: bestMoveForTT ? moveKeyUint32(bestMoveForTT, bestMoveForTT.promotion) : null });
  return best;
}

export function searchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore) {
  const maximizing = state.turn === SIDE.BLACK;
  const cached     = tt.get(hash);
  const ttMoveKey  = cached?.bestMoveKey ?? null;

  // Compute moves once — the debug log was calling getAllLegalMoves a second time
  // ES: Calcular movimientos una vez — el log de debug llamaba getAllLegalMoves una segunda vez
  const rawMoves = getAllLegalMoves(state, state.turn);
  dbg.search.group(`searchRoot d=${depth}`, {
    moves:     rawMoves.length,
    alpha, beta,
    ttHit:     !!cached,
    turn:      state.turn,
    prevScore,
  });
  const scoredMoves = [];
  for (let mi = 0; mi < rawMoves.length; mi++) {
    const m = rawMoves[mi];
    if (!m) continue;
    if (!m.fromReserve && !m.from) continue;
    const s = moveOrderScore(state, m, depth, hash);
    scoredMoves.push({ move: m, score: ttMoveKey && moveKeyUint32(m, m.promotion) === ttMoveKey ? s + 1_000_000 : s });
  }
  scoredMoves.sort((a, b) => b.score - a.score);
  const moves = [];
  for (let i = 0; i < scoredMoves.length; i++) moves.push(scoredMoves[i].move);

  if (!moves.length) {
    // OPT-2: Pass rawMoves (empty) to terminalScore — no extra getAllLegalMoves() call
    // ES: Pasar rawMoves (vacío) a terminalScore — sin llamada extra a getAllLegalMoves()
    const term = terminalScore(state, depth, rawMoves);
    return { bestMove: null, score: term ?? prevScore };
  }

  // FIX-1: Pre-compute which moves lead to a 3rd repetition so we can skip them
  // at the root unless they are literally the only legal move.
  // moveOrderScore already penalizes them, but the TT bonus (+1_000_000) was
  // overwhelming that penalty — here we hard-veto them before they are searched.
  // ES: Pre-calcular qué movimientos llevan a 3ª repetición para vetarlos en la raíz
  // salvo que sean el único movimiento legal disponible.
  const thirdRepMoveKeys = new Set();
  if (state.history?.length >= 2 && moves.length > 1) {
    for (const m of moves) {
      for (const pr of getBranches(state, m)) {
        const probe = makeMove(state, m, pr, hash, prevScore);
        if (probe.action) {
          if (countRepetitions(state.history, probe.hash) >= 2) {
            thirdRepMoveKeys.add(moveKeyUint32(m, pr));
          }
          unmakeMove(state, probe);
        }
      }
    }
    // If ALL moves repeat, clear the veto set — we must play something
    // ES: Si todos los movimientos repiten, limpiar el veto — hay que jugar algo
    if (thirdRepMoveKeys.size >= moves.length) thirdRepMoveKeys.clear();
  }

  let bestMove = null, bestScore = maximizing ? -INF : INF, moveCount = 0;
  for (const move of moves) {
    if (now() > deadline) throw new SearchTimeout();
    for (const promote of getBranches(state, move)) {
      // FIX-1: skip moves that cause a third repetition (unless no alternative)
      // ES: omitir movimientos que causan tercera repetición (salvo que no haya alternativa)
      if (thirdRepMoveKeys.has(moveKeyUint32(move, promote))) {
        dbg.ai.warn('searchRoot: skipping 3rd-rep move', { move: moveKey(move, promote) });
        continue;
      }
      moveCount++;
      const md        = makeMove(state, move, promote, hash, prevScore);
      if (!md.action || !md.undo) continue;
      try {
        let score;
        const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
        if (moveCount === 1) {
          score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
        } else {
          score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false);
          if (score > alpha && score < beta)
            score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
        }
        const cand = md.action;
        if (!cand) continue;
        if (maximizing) {
          if (score > bestScore) { bestScore = score; bestMove = cand; }
          if (bestScore > alpha) alpha = bestScore;
        } else {
          if (score < bestScore) { bestScore = score; bestMove = cand; }
          if (bestScore < beta)  beta = bestScore;
        }
        if (score > (maximizing ? bestScore - 100 : bestScore + 100) || moveCount <= 2) {
          dbg.search(`  move #${moveCount}`, {
            move: moveKey(move, promote), score,
            best: moveKey(bestMove, false), alpha, beta,
          });
        }
        if (alpha >= beta) {
          dbg.search(`  beta cutoff`, {
            move: moveKey(move, promote), score,
            best: moveKey(bestMove, false),
          });
          if (isQuiet(state, move, promote)) {
            storeKiller(depth, move);
            storeHistory(state.turn, move, depth);
          }
          tt.set(hash, { depth, score: bestScore, flag: TT_BETA,
            bestMoveKey: moveKeyUint32(bestMove || cand, (bestMove || cand).promotion) });
          return { bestMove, score: bestScore };
        }
      } finally {
        unmakeMove(state, md);
      }
    }
  }
  // FIX-1: If the veto eliminated every move (shouldn't happen given the size>1 guard
  // and the clear-if-all-repeat logic, but belt-and-suspenders), retry without veto.
  // ES: Si el veto eliminó todos los movimientos, reintentar sin veto (seguridad).
  if (moveCount === 0 && moves.length > 0) {
    dbg.ai.warn('searchRoot: all moves were vetoed, retrying without rep-veto');
    for (const move of moves) {
      if (now() > deadline) throw new SearchTimeout();
      for (const promote of getBranches(state, move)) {
        moveCount++;
        const md = makeMove(state, move, promote, hash, prevScore);
        if (!md.action || !md.undo) continue;
        try {
          let score;
          const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
          if (moveCount === 1) {
            score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
          } else {
            score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false);
            if (score > alpha && score < beta)
              score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false);
          }
          const cand = md.action;
          if (!cand) continue;
          if (maximizing) {
            if (score > bestScore) { bestScore = score; bestMove = cand; }
            if (bestScore > alpha) alpha = bestScore;
          } else {
            if (score < bestScore) { bestScore = score; bestMove = cand; }
            if (bestScore < beta)  beta = bestScore;
          }
          if (alpha >= beta) {
            tt.set(hash, { depth, score: bestScore, flag: TT_BETA,
              bestMoveKey: moveKeyUint32(bestMove || cand, (bestMove || cand).promotion) });
            return { bestMove, score: bestScore };
          }
        } finally {
          unmakeMove(state, md);
        }
      }
    }
  }

  tt.set(hash, { depth, score: bestScore, flag: TT_ALPHA,
    bestMoveKey: bestMove ? moveKeyUint32(bestMove, bestMove.promotion) : null });
  return { bestMove, score: bestScore };
}

function getBranches(state, move) {
  if (isValidMove(move) && !move.fromReserve && move.from && move.to
      && isPromotionAvailableForMove(state, move.from, move.to))
    return [true, false];
  return [false];
}

function isValidMove(move) {
  if (!move || typeof move !== 'object') return false;
  if (move.fromReserve)
    return Number.isInteger(move.reserveIndex)
      && move.to && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
  return move.from && move.to
    && Number.isInteger(move.from.r) && Number.isInteger(move.from.c)
    && Number.isInteger(move.to.r)   && Number.isInteger(move.to.c);
}

function isBacktrack(state, move) {
  const last = state.lastMove;
  if (!last || move.fromReserve || !last.from || !last.to || !move.from || !move.to) return false;
  return move.from.r === last.to.r && move.from.c === last.to.c
      && move.to.r   === last.from.r && move.to.c === last.from.c;
}

function kingPenalty(state, move) {
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c];
  if (!piece || piece.type !== 'king') return 0;
  let pen = 0;
  const KING_MOVE_PENALTY = 120;
  if (!isPalaceSquare(move.to.r, move.to.c, piece.side))   pen += KING_MOVE_PENALTY;
  if (isPalaceSquare(move.from.r, move.from.c, piece.side)
   && !isPalaceSquare(move.to.r, move.to.c, piece.side))   pen += 80;
  if (!isKingInCheck(state, piece.side))                    pen += 40;
  return pen;
}

function kingShufflePen(state, move) {
  const KING_SHUFFLE_PENALTY = 400;
  if (!move || move.fromReserve || !move.from || !move.to) return 0;
  const piece = state.board?.[move.from.r]?.[move.from.c];
  if (!piece || piece.type !== 'king') return 0;
  const last = state.lastMove;
  if (!last?.from || !last?.to) return 0;
  return (last.from.r === move.to.r && last.from.c === move.to.c
       && last.to.r   === move.from.r && last.to.c === move.from.c)
    ? KING_SHUFFLE_PENALTY : 0;
}

// ── OPT-3: countMaterial hoisted to module level — was re-declared as an inner
// function on every search() call, causing per-node function allocation overhead.
// ES: countMaterial movido a nivel de módulo para evitar re-declaración por nodo.
function countMaterial(board) {
  let count = 0;
  for (let r = 0; r < 13; r++)
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (p && p.type !== 'king' && p.type !== 'pawn') count++;
    }
  return count;
}

// currentHash: pass the already-known hash from the search node to avoid
// recomputing computeFullHash(state) once per candidate move (was O(169) × N).
// ES: currentHash: pasar el hash ya conocido del nodo de búsqueda para evitar
// recalcular computeFullHash(state) una vez por movimiento candidato (era O(169) × N).
function moveOrderScore(state, move, depth, currentHash = null) {
  if (!isValidMove(move)) return -999_999;
  const side   = state.turn;
  const moving = move.fromReserve
    ? state.reserves[side]?.[move.reserveIndex]
    : state.board?.[move.from?.r]?.[move.from?.c];
  if (!moving || !move.to) return -999_999;

  const target = state.board?.[move.to.r]?.[move.to.c] ?? null;
  let score = 0;
  const PALACE_PRESSURE_BONUS = 350;

  // MVV-LVA: Most Valuable Victim - Least Valuable Attacker
  // Much faster than full SEE for move ordering; SEE is kept for quiescence search
  // ES: MVV-LVA: Víctima más valiosa - Atacante menos valioso
  // Mucho más rápido que SEE completo para ordenamiento; SEE se mantiene en quiescence search
  if (target) {
    const victimVal = pieceValue(target);
    const attackerVal = pieceValue(moving);
    // MVV-LVA formula: victim*12 - attacker*2 + bonus for positive trade
    const tradeBonus = victimVal > attackerVal ? 2000 : (victimVal === attackerVal ? 1000 : -500);
    score += victimVal * 12 - attackerVal * 2 + tradeBonus;
  }

  if (!move.fromReserve && move.from && move.to
      && isPromotionAvailableForMove(state, move.from, move.to) && !moving.promoted)
    score += 280;

  score += (12 - Math.abs(move.to.r - 6) - Math.abs(move.to.c - 6)) * 2;

  if (!move.fromReserve && moving.type === 'archer' && onBank(side, move.to.r)) score += 400;
  if (!move.fromReserve && moving.type === 'archer') {
    const forward = side === SIDE.WHITE ? 1 : -1;
    if ((move.to.r - move.from.r) * forward > 0) score += 50;
  }

  if (!move.fromReserve && moving.type !== 'king') {
    const enemyBaseRow = side === SIDE.WHITE ? 12 : 0;
    const f            = side === SIDE.WHITE ? 1  : -1;
    const dist         = (enemyBaseRow - move.to.r) * f;
    if (dist < 6) score += (6 - dist) * 10;
  }

  if (move.fromReserve) {
    score += 100;
    if ((side === SIDE.WHITE && move.to.r >= 7) || (side === SIDE.BLACK && move.to.r <= 5)) score += 80;
    if ((side === SIDE.WHITE && move.to.r >= 9) || (side === SIDE.BLACK && move.to.r <= 3)) score += 60;
  }

  const enemy = opponent(side);
  if (isPalaceSquare(move.to.r, move.to.c, enemy)) score += PALACE_PRESSURE_BONUS;

  const IMMEDIATE_BACKTRACK_PENALTY = 500;
  if (isBacktrack(state, move)) score -= IMMEDIATE_BACKTRACK_PENALTY;
  score -= kingPenalty(state, move);
  score -= kingShufflePen(state, move);

  // Compute moveKey once — was previously called 3 separate times (killerScore,
  // historyScore, adaptiveMemory.getMovepenalty) each building the same string.
  // ES: Calcular moveKey una vez — antes se llamaba 3 veces (killerScore, historyScore,
  // adaptiveMemory.getMovepenalty) construyendo el mismo string cada vez.
  const mk = moveKeyUint32(move, move.promotion ?? false);
  score += killerScore(depth, mk);
  score += Math.min(200, historyScore(side, mk) / 8);
  score -= adaptiveMemory.getMovepenalty(moveKey(move, move.promotion ?? false));

  // Repetition penalty using the actual future hash when available.
  // This avoids mis-ordering based on the current board only, which is
  // incorrect for all non-pass moves.
  if (currentHash !== null && state.history?.length >= 2) {
    let futureHash = null;
    const md = makeMove(state, move, move.promotion ?? false, currentHash);
    if (md.action) {
      futureHash = md.hash;
      unmakeMove(state, md);
    }
    if (futureHash !== null) {
      const seen = countRepetitions(state.history, futureHash);
      if (seen >= 2) {
        // FIX-2: must exceed TT bonus (+1_000_000) so no repetition ever wins ordering
        // ES: debe superar el bonus del TT move para que ninguna repetición gane el ordenamiento
        score -= 2_000_000;  // third repetition → completely forbidden
      } else if (seen === 1) {
        score -= 8000;       // second repetition → strongly penalized
      } else {
        const drawPen = adaptiveMemory.getDrawPenalty(futureHash.toString());
        score -= drawPen * 3;
      }
    }
  }

  if (!move.fromReserve) {
    let forkCount = 0;
    const FORK_BONUS = 120;
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nr = move.to.r + dr, nc = move.to.c + dc;
      if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
        const p = state.board[nr][nc];
        if (p && p.side === enemy && pieceValue(p) > 250) forkCount++;
      }
    }
    if (forkCount >= 2) score += FORK_BONUS * forkCount;
  }

  return score;
}

export function allocateTime(startTime, timeLimitMs, moveCount = 30) {
  const elapsed    = now() - startTime;
  const remaining  = timeLimitMs - elapsed;
  const movesLeft  = Math.max(5, moveCount - 10);
  const timePerMove = remaining / movesLeft;
  return Math.min(timePerMove * 0.8, timeLimitMs * 0.3);
}