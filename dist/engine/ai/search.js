import { opponent, isPalaceSquare, onBank } from '../constants.ts';
import { getAllLegalMoves, isKingInCheck, isPromotionAvailableForMove, isSquareAttacked } from '../rules/index.ts';
import { ZobristTurn } from './hashing.ts';
import { evaluate, buildAttackMap } from './evaluation.ts';
import { makeMove, unmakeMove, isSEEPositive, pieceValue } from './moves.ts';
import { adaptiveMemory } from './memory.ts';
import { createIncrementalMaps, applyMoveToMaps } from './incremental-attack.ts';
import { getMaterialCache, setMaterialCache } from './material-cache.ts';
const MATE_SCORE = 1_000_000;
const INF = 1_000_000_000;
const TT_EXACT = 0, TT_ALPHA = 1, TT_BETA = 2;
const FUTILITY_MARGIN = [0, 150, 300, 500];
const DRAW_CONTEMPT = 180;
const QSEARCH_MAX_DEPTH = 6;
const QDELTA_MARGIN = 600;
const killerMoves = new Map();
const historyTable = { white: new Map(), black: new Map() };
const KILLER_SLOTS = 2;
const PAT_BASE_PEN = 80;
const PAT_MAX_PEN = 480;
const PAT_STAG_PEN = 100;
const PAT_ADV_THRESHOLD = 1;
export class GameDanceTracker {
    windowSize;
    visits;
    centroids;
    ring;
    constructor(windowSize = 30) {
        this.windowSize = windowSize;
        this.visits = { white: new Map(), black: new Map() };
        this.centroids = { white: new Map(), black: new Map() };
        this.ring = { white: [], black: [] };
    }
    record(side, piece, fr, fc, tr, tc) {
        if (!piece || piece.type === 'king')
            return;
        const id = piece.id ?? `${piece.type}@${fr},${fc}`;
        const key = `${piece.type}@${id}`;
        const cellIdx = tr * 13 + tc;
        const sv = this.visits[side];
        const sc = this.centroids[side];
        const ring = this.ring[side];
        let pm = sv.get(key);
        if (!pm) {
            pm = new Map();
            sv.set(key, pm);
        }
        pm.set(cellIdx, (pm.get(cellIdx) ?? 0) + 1);
        let ce = sc.get(key);
        if (!ce) {
            ce = { sumRow: 0, count: 0 };
            sc.set(key, ce);
        }
        ce.sumRow += tr;
        ce.count++;
        if (ring.length >= this.windowSize) {
            const evicted = ring.shift();
            const epm = sv.get(evicted.key);
            if (epm) {
                const prev = epm.get(evicted.cellIdx) ?? 0;
                if (prev <= 1)
                    epm.delete(evicted.cellIdx);
                else
                    epm.set(evicted.cellIdx, prev - 1);
                if (epm.size === 0)
                    sv.delete(evicted.key);
            }
            const ece = sc.get(evicted.key);
            if (ece) {
                ece.sumRow -= evicted.toRow;
                ece.count = Math.max(0, ece.count - 1);
                if (ece.count === 0)
                    sc.delete(evicted.key);
            }
        }
        ring.push({ key, cellIdx, toRow: tr });
    }
    oscillation(side, piece, fr, fc, tr, tc) {
        if (!piece || piece.type === 'king')
            return 0;
        const id = piece.id ?? `${piece.type}@${fr},${fc}`;
        const key = `${piece.type}@${id}`;
        const pm = this.visits[side]?.get(key);
        if (!pm)
            return 0;
        const visits = pm.get(tr * 13 + tc) ?? 0;
        if (visits < 1)
            return 0;
        return Math.min(PAT_MAX_PEN, visits * PAT_BASE_PEN);
    }
    stagnation(side, piece, fr, fc, tr, tc) {
        if (!piece || piece.type === 'king')
            return 0;
        const id = piece.id ?? `${piece.type}@${fr},${fc}`;
        const key = `${piece.type}@${id}`;
        const ce = this.centroids[side]?.get(key);
        if (!ce || ce.count < 3)
            return 0;
        const avgRow = ce.sumRow / ce.count;
        const advance = side === 'black' ? fr - avgRow : avgRow - fr;
        if (advance >= PAT_ADV_THRESHOLD)
            return 0;
        const thisMoveAdv = side === 'black' ? fr - tr : tr - fr;
        return PAT_STAG_PEN + (thisMoveAdv <= 0 ? PAT_STAG_PEN : 0);
    }
    reset() {
        this.visits = { white: new Map(), black: new Map() };
        this.centroids = { white: new Map(), black: new Map() };
        this.ring = { white: [], black: [] };
    }
}
let _activeDanceTracker = null;
function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
class SearchTimeout extends Error {
}
const DROP_MOVE_FLAG = 1 << 31;
export function moveKey(move, promote = false) {
    if (!move)
        return 'null';
    if (move.fromReserve)
        return `R:${move.reserveIndex}->${move.to.r},${move.to.c}`;
    const promotionFlag = promote ? ':p1' : ':p0';
    return `M:${move.from.r},${move.from.c}->${move.to.r},${move.to.c}${promotionFlag}`;
}
export function moveKeyUint32(move, promote = false) {
    if (!move)
        return 0;
    if (move.fromReserve) {
        const reserveIndex = Number.isInteger(move.reserveIndex) ? move.reserveIndex & 0xF : 0;
        const r = move.to?.r ?? 0, c = move.to?.c ?? 0;
        return (((DROP_MOVE_FLAG >>> 0) | ((reserveIndex & 0xF) << 24) | ((r & 0xF) << 20) | ((c & 0xF) << 16)) >>> 0);
    }
    const fr = move.from?.r ?? 0, fc = move.from?.c ?? 0;
    const tr = move.to?.r ?? 0, tc = move.to?.c ?? 0;
    const p = promote ? 1 : 0;
    return (((fr & 0xF) << 28) | ((fc & 0xF) << 24) | ((tr & 0xF) << 20) | ((tc & 0xF) << 16) | ((p & 1) << 15)) >>> 0;
}
function storeKiller(depth, move) {
    const key = moveKeyUint32(move, move.promotion ?? false);
    const prev = killerMoves.get(depth) ?? [];
    if (prev[0] === key)
        return;
    killerMoves.set(depth, [key, prev[0] ?? null].filter(Boolean).slice(0, KILLER_SLOTS));
}
function killerScore(depth, mk) {
    const arr = killerMoves.get(depth);
    if (!arr)
        return 0;
    return arr[0] === mk ? 900 : arr[1] === mk ? 650 : 0;
}
function historyScore(side, mk) { return historyTable[side].get(mk) ?? 0; }
function storeHistory(side, move, depth) {
    const key = moveKeyUint32(move, move.promotion ?? false);
    historyTable[side].set(key, (historyTable[side].get(key) ?? 0) + depth * depth);
}
export function decayHistoryTable() {
    const w = historyTable.white, b = historyTable.black;
    for (const entry of w)
        w.set(entry[0], entry[1] >> 1);
    for (const entry of b)
        b.set(entry[0], entry[1] >> 1);
}
function isQuiet(state, move, promote) {
    return !move || move.fromReserve || promote ? false : !state.board?.[move.to?.r]?.[move.to?.c];
}
function terminalScore(state, depth, precomputedMoves = null) {
    try {
        const legal = precomputedMoves ?? getAllLegalMoves(state, state.turn) ?? [];
        const inCheck = isKingInCheck(state, state.turn);
        if (legal.length === 0)
            return inCheck ? (state.turn === 'black' ? -MATE_SCORE + depth : MATE_SCORE - depth) : 0;
        return null;
    }
    catch {
        return null;
    }
}
function isTactical(state, move) {
    if (!move || !move.to)
        return false;
    if (move.fromReserve) {
        if (isPalaceSquare(move.to.r, move.to.c, opponent(state.turn)))
            return true;
        if (isPalaceSquare(move.to.r, move.to.c, state.turn))
            return true;
        return false;
    }
    if (!move.from || !move.to)
        return false;
    const moving = state.board?.[move.from.r]?.[move.from.c];
    if (!moving)
        return false;
    const target = state.board?.[move.to.r]?.[move.to.c];
    if (target) {
        if (isPalaceSquare(move.to.r, move.to.c, state.turn))
            return true;
        return true;
    }
    return !moving.promoted && isPromotionAvailableForMove(state, move.from, move.to);
}
function givesCheck(state, move) {
    if (!move || move.fromReserve || !move.from || !move.to)
        return false;
    const md = makeMove(state, move, false, 0n, null);
    if (!md.action)
        return false;
    const inCheck = isKingInCheck(state, opponent(state.turn));
    unmakeMove(state, md);
    return inCheck;
}
function countRepetitions(history, hash) {
    let seen = 0;
    for (const h of history)
        if (h === hash)
            seen++;
    return seen;
}
function _extractMoveInfo(md, move) {
    let movedPiece = null, capturedPiece = null;
    if (md.undo && md.undo.cells) {
        for (let i = 0; i < md.undo.cellCount; i++) {
            const cell = md.undo.cells[i];
            if (!move.fromReserve && move.from && cell.r === move.from.r && cell.c === move.from.c)
                movedPiece = cell.p;
            else if (move.to && cell.r === move.to.r && cell.c === move.to.c)
                capturedPiece = cell.p;
        }
    }
    return { movedPiece, capturedPiece };
}
function _applyMaps(maps, state, move, md, promote) {
    if (!maps)
        return null;
    try {
        const { movedPiece, capturedPiece } = _extractMoveInfo(md, move);
        applyMoveToMaps(maps, state, move, capturedPiece, movedPiece, promote);
        return maps;
    }
    catch {
        return null;
    }
}
function _rebuildMaps(maps, board) {
    if (!maps)
        return;
    try {
        maps._blackInc?.rebuild(board);
        maps._whiteInc?.rebuild(board);
        if (maps._blackInc)
            maps.black = maps._blackInc.get();
        if (maps._whiteInc)
            maps.white = maps._whiteInc.get();
    }
    catch { }
}
function quiescence(state, alpha, beta, deadline, hash, staticEval = null, qdepth = QSEARCH_MAX_DEPTH, maps = null) {
    if (now() > deadline)
        throw new SearchTimeout();
    const maximizing = state.turn === 'black';
    const inCheck = isKingInCheck(state, state.turn);
    const precomputed = maps ? { black: maps.black, white: maps.white } : null;
    const ev = staticEval ?? evaluate(state, hash, precomputed, true).score;
    if (qdepth <= 0 && !inCheck)
        return ev;
    let best = inCheck ? (maximizing ? -INF : INF) : ev;
    if (!inCheck) {
        if (maximizing) {
            if (best >= beta)
                return best;
            alpha = Math.max(alpha, best);
            if (ev + QDELTA_MARGIN < alpha)
                return ev;
        }
        else {
            if (best <= alpha)
                return best;
            beta = Math.min(beta, best);
            if (ev - QDELTA_MARGIN > beta)
                return ev;
        }
    }
    const moves = getAllLegalMoves(state, state.turn)
        .filter((m) => m && (inCheck || isTactical(state, m)))
        .sort((a, b) => moveOrderScore(state, b, 0) - moveOrderScore(state, a, 0));
    for (const move of moves) {
        if (now() > deadline)
            throw new SearchTimeout();
        if (!inCheck && !move.fromReserve && state.board[move.to?.r]?.[move.to?.c]) {
            if (!isSEEPositive(state, move, buildAttackMap))
                continue;
        }
        for (const promote of getBranches(state, move)) {
            const md = makeMove(state, move, promote, hash, best);
            if (!md.action || !md.undo)
                continue;
            const childMaps = _applyMaps(maps, state, move, md, promote);
            try {
                const score = -quiescence(state, -beta, -alpha, deadline, md.hash, md.evalDiff ? -best - md.evalDiff : null, qdepth - 1, childMaps ? maps : null);
                if (maximizing) {
                    if (score > best)
                        best = score;
                    alpha = Math.max(alpha, best);
                    if (alpha >= beta)
                        return best;
                }
                else {
                    if (score < best)
                        best = score;
                    beta = Math.min(beta, best);
                    if (alpha >= beta)
                        return best;
                }
            }
            finally {
                unmakeMove(state, md);
                _rebuildMaps(maps, state.board);
            }
        }
    }
    return best;
}
export function search(state, depth, alpha, beta, deadline, tt, hash, staticEval = null, isNullMove = false, maps = null) {
    if (now() > deadline)
        throw new SearchTimeout();
    if (state.history?.length >= 2) {
        const reps = countRepetitions(state.history, hash);
        if (reps >= 2) {
            return state.turn === 'black' ? -DRAW_CONTEMPT : DRAW_CONTEMPT;
        }
        if (reps === 1) {
            const precomputed = maps ? { black: maps.black, white: maps.white } : null;
            if (staticEval === null)
                staticEval = evaluate(state, hash, precomputed, true).score;
            staticEval -= (state.turn === 'black' ? 1 : -1) * 600;
        }
    }
    const cached = tt.get(hash);
    if (cached && cached.depth >= depth) {
        if (cached.flag === 0)
            return cached.score;
        if (cached.flag === 1 && cached.score <= alpha)
            return alpha;
        if (cached.flag === 2 && cached.score >= beta)
            return beta;
    }
    const rawMoves = getAllLegalMoves(state, state.turn);
    const term = terminalScore(state, depth, rawMoves);
    if (term !== null)
        return term;
    if (depth <= 0)
        return quiescence(state, alpha, beta, deadline, hash, staticEval, QSEARCH_MAX_DEPTH, maps);
    const maximizing = state.turn === 'black';
    const inCheck = isKingInCheck(state, state.turn);
    const precomputed = maps ? { black: maps.black, white: maps.white } : null;
    if (staticEval === null)
        staticEval = evaluate(state, hash, precomputed, true).score;
    if (!inCheck && depth <= 2) {
        const razorMargin = depth === 1 ? 250 : 450;
        if (maximizing && staticEval + razorMargin <= alpha)
            return quiescence(state, alpha, beta, deadline, hash, staticEval, QSEARCH_MAX_DEPTH, maps);
        if (!maximizing && staticEval - razorMargin >= beta)
            return quiescence(state, alpha, beta, deadline, hash, staticEval, QSEARCH_MAX_DEPTH, maps);
    }
    const hasDrops = state.reserves[state.turn].length > 0;
    const curseActive = state.palaceCurse?.[state.turn]?.active;
    if (!isNullMove && depth >= 3 && !inCheck && !hasDrops && !curseActive && countMaterial(state.board) > 4) {
        let kingAttacked = false;
        for (let r = 0; r < 13 && !kingAttacked; r++)
            for (let c = 0; c < 13 && !kingAttacked; c++) {
                const p = state.board[r][c];
                if (p && p.side === state.turn && p.type === 'king')
                    kingAttacked = isSquareAttacked(state.board, r, c, opponent(state.turn), state);
            }
        if (!kingAttacked) {
            const saved = state.turn;
            state.turn = opponent(saved);
            const R = depth > 6 ? 3 : 2;
            const nullScore = -search(state, depth - 1 - R, -beta, -alpha, deadline, tt, hash ^ ZobristTurn[0] ^ ZobristTurn[1], staticEval, true, maps);
            state.turn = saved;
            if (maximizing && nullScore >= beta)
                return beta;
            if (!maximizing && nullScore <= alpha)
                return alpha;
        }
    }
    const ttMoveKey = cached?.bestMoveKey ?? null;
    let effectiveDepth = depth;
    if (!ttMoveKey && depth >= 5 && !inCheck)
        effectiveDepth = depth - 1;
    let hashFlag = 1, bestMoveForTT = null;
    const scoredMoves = [];
    for (let mi = 0; mi < rawMoves.length; mi++) {
        const m = rawMoves[mi];
        if (!m)
            continue;
        if (!m.fromReserve && !m.from)
            continue;
        const s = moveOrderScore(state, m, depth, hash);
        scoredMoves.push({ move: m, score: ttMoveKey && moveKeyUint32(m, m.promotion) === ttMoveKey ? s + 1_000_000 : s });
    }
    scoredMoves.sort((a, b) => b.score - a.score);
    const moves = scoredMoves.map(sm => sm.move);
    if (effectiveDepth >= 3 && !inCheck && Math.abs(beta) < MATE_SCORE / 2) {
        const probDepth = effectiveDepth - 4;
        const probMargin = 150;
        for (const move of moves) {
            if (isTactical(state, move))
                continue;
            const md = makeMove(state, move, false, hash, staticEval);
            if (!md.action)
                continue;
            const childMaps = _applyMaps(maps, state, move, md, false);
            try {
                const probScore = -search(state, probDepth, -beta - probMargin, -beta + probMargin, deadline, tt, md.hash, null, false, childMaps ? maps : null);
                if (probScore >= beta) {
                    return probScore;
                }
            }
            finally {
                unmakeMove(state, md);
                _rebuildMaps(maps, state.board);
            }
        }
    }
    let best = maximizing ? -INF : INF, moveCount = 0;
    for (const move of moves) {
        if (now() > deadline)
            throw new SearchTimeout();
        if (!inCheck && effectiveDepth <= 3 && staticEval !== null && !move.fromReserve) {
            const margin = FUTILITY_MARGIN[Math.min(effectiveDepth, 3)];
            const isCapture = !!state.board[move.to?.r]?.[move.to?.c];
            if (!isCapture && !isTactical(state, move)) {
                if (maximizing && staticEval + margin <= alpha)
                    continue;
                if (!maximizing && staticEval - margin >= beta)
                    continue;
            }
        }
        for (const promote of getBranches(state, move)) {
            moveCount++;
            const tactical = isTactical(state, move) || promote;
            const md = makeMove(state, move, promote, hash, staticEval);
            if (!md.action || !md.undo)
                continue;
            const childMaps = _applyMaps(maps, state, move, md, promote);
            try {
                let score;
                const childEval = md.evalDiff ? staticEval + md.evalDiff : null;
                if (moveCount === 1) {
                    score = -search(state, effectiveDepth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? maps : null);
                }
                else {
                    let reduction = 0;
                    if (effectiveDepth >= 3 && moveCount >= 3 && !tactical && !inCheck) {
                        reduction = Math.floor(Math.log(effectiveDepth) * Math.log(moveCount) / 2);
                        reduction = Math.max(1, Math.min(reduction, effectiveDepth - 2));
                    }
                    score = -search(state, effectiveDepth - 1 - reduction, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? maps : null);
                    if (score > alpha && reduction > 0)
                        score = -search(state, effectiveDepth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? maps : null);
                    if (score > alpha && score < beta)
                        score = -search(state, effectiveDepth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? maps : null);
                }
                if (maximizing) {
                    if (score > best) {
                        best = score;
                        bestMoveForTT = move;
                    }
                    if (best > alpha) {
                        alpha = best;
                        hashFlag = 0;
                    }
                }
                else {
                    if (score < best) {
                        best = score;
                        bestMoveForTT = move;
                    }
                    if (best < beta) {
                        beta = best;
                        hashFlag = 0;
                    }
                }
                if (alpha >= beta) {
                    if (isQuiet(state, move, promote)) {
                        storeKiller(depth, move);
                        storeHistory(state.turn, move, depth);
                    }
                    return best;
                }
            }
            finally {
                unmakeMove(state, md);
                _rebuildMaps(maps, state.board);
            }
        }
    }
    return best;
}
export function searchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore, rootNNByMoveKey = null, danceTracker = null) {
    const maximizing = state.turn === 'black';
    const cached = tt.get(hash);
    const ttMoveKey = cached?.bestMoveKey ?? null;
    _activeDanceTracker = danceTracker ?? null;
    const rawMoves = getAllLegalMoves(state, state.turn);
    const rng = (Math.random() - 0.5) * 0.01;
    const scoredMoves = [];
    for (let mi = 0; mi < rawMoves.length; mi++) {
        const m = rawMoves[mi];
        if (!m)
            continue;
        if (!m.fromReserve && !m.from)
            continue;
        const s = moveOrderScore(state, m, depth, hash);
        const mk = moveKeyUint32(m, m.promotion ?? false);
        const nnRaw = rootNNByMoveKey ? (rootNNByMoveKey.get?.(mk) ?? rootNNByMoveKey[mk] ?? null) : null;
        const nnBonus = typeof nnRaw === 'number' && Number.isFinite(nnRaw) ? Math.max(-250, Math.min(250, Math.round(nnRaw * 180))) : 0;
        scoredMoves.push({ move: m, score: s + nnBonus + (ttMoveKey && mk === ttMoveKey ? 1_000_000 : 0) + rng });
    }
    scoredMoves.sort((a, b) => b.score - a.score);
    const moves = scoredMoves.map(sm => sm.move);
    if (!moves.length) {
        const term = terminalScore(state, depth, rawMoves);
        return { bestMove: null, score: term ?? prevScore };
    }
    let rootMaps = null;
    try {
        rootMaps = createIncrementalMaps(state.board);
    }
    catch {
        rootMaps = null;
    }
    const thirdRepMoveKeys = new Set();
    if (state.history?.length >= 2 && moves.length > 1) {
        for (const m of moves) {
            for (const pr of getBranches(state, m)) {
                const probe = makeMove(state, m, pr, hash, prevScore);
                if (probe.action && probe.undo) {
                    if (countRepetitions(state.history, probe.hash) >= 3)
                        thirdRepMoveKeys.add(moveKeyUint32(m, pr));
                }
                if (probe.undo)
                    unmakeMove(state, probe);
            }
        }
        if (thirdRepMoveKeys.size >= moves.length)
            thirdRepMoveKeys.clear();
    }
    let bestMove = null, bestScore = maximizing ? -INF : INF, moveCount = 0;
    const branchesCache = new Map();
    for (const move of moves) {
        if (now() > deadline)
            throw new SearchTimeout();
        let branches = branchesCache.get(move);
        if (!branches) {
            branches = getBranches(state, move);
            branchesCache.set(move, branches);
        }
        for (const promote of branches) {
            if (thirdRepMoveKeys.has(moveKeyUint32(move, promote)))
                continue;
            moveCount++;
            const md = makeMove(state, move, promote, hash, prevScore);
            if (!md.action || !md.undo)
                continue;
            const childMaps = _applyMaps(rootMaps, state, move, md, promote);
            try {
                let score;
                const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
                if (moveCount === 1) {
                    score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
                }
                else {
                    score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
                    if (score > alpha && score < beta)
                        score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
                }
                const cand = md.action;
                if (!cand)
                    continue;
                if (maximizing) {
                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = cand;
                    }
                    if (bestScore > alpha)
                        alpha = bestScore;
                }
                else {
                    if (score < bestScore) {
                        bestScore = score;
                        bestMove = cand;
                    }
                    if (bestScore < beta)
                        beta = bestScore;
                }
                if (alpha >= beta) {
                    if (isQuiet(state, move, promote)) {
                        storeKiller(depth, move);
                        storeHistory(state.turn, move, depth);
                    }
                    return { bestMove, score: bestScore };
                }
            }
            finally {
                unmakeMove(state, md);
                _rebuildMaps(rootMaps, state.board);
            }
        }
    }
    if (moveCount === 0 && moves.length > 0) {
        for (const move of moves) {
            if (now() > deadline)
                throw new SearchTimeout();
            for (const promote of getBranches(state, move)) {
                moveCount++;
                const md = makeMove(state, move, promote, hash, prevScore);
                if (!md.action || !md.undo)
                    continue;
                const childMaps = _applyMaps(rootMaps, state, move, md, promote);
                try {
                    let score;
                    const childEval = md.evalDiff ? prevScore + md.evalDiff : null;
                    if (moveCount === 1) {
                        score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
                    }
                    else {
                        score = -search(state, depth - 1, -alpha - 1, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
                        if (score > alpha && score < beta)
                            score = -search(state, depth - 1, -beta, -alpha, deadline, tt, md.hash, childEval, false, childMaps ? rootMaps : null);
                    }
                    const cand = md.action;
                    if (!cand)
                        continue;
                    if (maximizing) {
                        if (score > bestScore) {
                            bestScore = score;
                            bestMove = cand;
                        }
                        if (bestScore > alpha)
                            alpha = bestScore;
                    }
                    else {
                        if (score < bestScore) {
                            bestScore = score;
                            bestMove = cand;
                        }
                        if (bestScore < beta)
                            beta = bestScore;
                    }
                    if (alpha >= beta)
                        return { bestMove, score: bestScore };
                }
                finally {
                    unmakeMove(state, md);
                    _rebuildMaps(rootMaps, state.board);
                }
            }
        }
    }
    _activeDanceTracker = null;
    return { bestMove, score: bestScore };
}
function getBranches(state, move) {
    if (!isValidMove(move) || move.fromReserve || !move.from || !move.to)
        return [false];
    if (!isPromotionAvailableForMove(state, move.from, move.to))
        return [false];
    const piece = state.board[move.from.r]?.[move.from.c];
    if (!piece)
        return [false];
    if (piece.type === 'pawn')
        return [true];
    const enemySide = opponent(state.turn);
    const destAttacked = isSquareAttacked(state.board, move.to.r, move.to.c, enemySide, state);
    return destAttacked ? [true, false] : [true];
}
function isValidMove(move) {
    if (!move || typeof move !== 'object')
        return false;
    if (move.fromReserve)
        return Number.isInteger(move.reserveIndex) && move.to && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
    return move.from && move.to && Number.isInteger(move.from.r) && Number.isInteger(move.from.c) && Number.isInteger(move.to.r) && Number.isInteger(move.to.c);
}
function isBacktrack(state, move) {
    const last = state.lastMove;
    if (!last || move.fromReserve || !last.from || !last.to || !move.from || !move.to)
        return false;
    return move.from.r === last.to.r && move.from.c === last.to.c && move.to.r === last.from.r && move.to.c === last.from.c;
}
function kingPenalty(state, move) {
    if (!move || move.fromReserve || !move.from || !move.to)
        return 0;
    const piece = state.board?.[move.from.r]?.[move.from.c];
    if (!piece || piece.type !== 'king')
        return 0;
    let pen = 0;
    const KING_MOVE_PENALTY = 120;
    if (!isPalaceSquare(move.to.r, move.to.c, piece.side))
        pen += KING_MOVE_PENALTY;
    if (isPalaceSquare(move.from.r, move.from.c, piece.side) && !isPalaceSquare(move.to.r, move.to.c, piece.side))
        pen += 80;
    if (!isKingInCheck(state, piece.side))
        pen += 40;
    return pen;
}
function kingShufflePen(state, move) {
    const KING_SHUFFLE_PENALTY = 400;
    if (!move || move.fromReserve || !move.from || !move.to)
        return 0;
    const piece = state.board?.[move.from.r]?.[move.from.c];
    if (!piece || piece.type !== 'king')
        return 0;
    const last = state.lastMove;
    if (!last?.from || !last?.to)
        return 0;
    return (last.from.r === move.to.r && last.from.c === move.to.c && last.to.r === move.from.r && last.to.c === move.from.c) ? KING_SHUFFLE_PENALTY : 0;
}
function boardChecksum(board) {
    let cs = 0;
    for (let r = 0; r < 13; r++) {
        const row = board[r];
        for (let c = 0; c < 13; c++) {
            const p = row[c];
            if (!p)
                continue;
            const id = (p.side === 'black' ? 0x8000 : 0) | (r << 8) | (c << 4) | (p.type.charCodeAt(0) & 0xF);
            cs ^= id ^ (p.promoted ? 0x10000 : 0);
        }
    }
    return cs;
}
function countMaterial(board) {
    const cached = getMaterialCache();
    if (cached >= 0)
        return cached;
    let count = 0;
    for (let r = 0; r < 13; r++) {
        const row = board[r];
        for (let c = 0; c < 13; c++) {
            const p = row[c];
            if (p && p.type !== 'king' && p.type !== 'pawn')
                count++;
        }
    }
    setMaterialCache(count);
    return count;
}
function moveOrderScore(state, move, depth, currentHash = null) {
    if (!isValidMove(move))
        return -999_999;
    const side = state.turn;
    const moving = move.fromReserve ? state.reserves[side]?.[move.reserveIndex] : state.board?.[move.from?.r]?.[move.from?.c];
    if (!moving || !move.to)
        return -999_999;
    const target = state.board?.[move.to.r]?.[move.to.c] ?? null;
    let score = 0;
    const PALACE_PRESSURE_BONUS = 350;
    if (target) {
        const victimVal = pieceValue(target);
        const attackerVal = pieceValue(moving);
        const tradeBonus = victimVal > attackerVal ? 2500 : (victimVal >= attackerVal ? 1500 : 200);
        score += victimVal * 15 - attackerVal * 2 + tradeBonus;
    }
    if (!move.fromReserve && move.from && move.to && isPromotionAvailableForMove(state, move.from, move.to) && !moving.promoted)
        score += 600;
    score += (12 - Math.abs(move.to.r - 6) - Math.abs(move.to.c - 6)) * 2;
    if (!move.fromReserve && moving.type === 'archer' && onBank(side, move.to.r))
        score += 400;
    if (isBacktrack(state, move))
        score -= 500;
    score -= kingPenalty(state, move);
    score -= kingShufflePen(state, move);
    const mk = moveKeyUint32(move, move.promotion ?? false);
    score += killerScore(depth, mk);
    score += Math.min(200, historyScore(side, mk) / 8);
    score -= Math.min(1200, adaptiveMemory.getMovepenalty(moveKey(move, move.promotion ?? false)));
    if (currentHash !== null && state.history?.length >= 2) {
        const futureHash = currentHash ^ ZobristTurn[0] ^ ZobristTurn[1];
        const seen = countRepetitions(state.history, futureHash);
        if (seen >= 2)
            score -= 20000;
        else if (seen === 1)
            score -= 4000;
    }
    const enemy = opponent(side);
    if (isPalaceSquare(move.to.r, move.to.c, enemy))
        score += PALACE_PRESSURE_BONUS;
    if (target && target.side === enemy && isPalaceSquare(move.to.r, move.to.c, side))
        score += 3000;
    if (state.palaceCurse?.[enemy]?.active && isPalaceSquare(move.to.r, move.to.c, enemy))
        score += 2000;
    return score;
}
export function allocateTime(startTime, timeLimitMs, moveCount = 30) {
    const elapsed = now() - startTime;
    const remaining = timeLimitMs - elapsed;
    const movesLeft = Math.max(5, moveCount - 10);
    const timePerMove = remaining / movesLeft;
    return Math.min(timePerMove * 0.8, timeLimitMs * 0.3);
}
