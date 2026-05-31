// Evaluation - TypeScript
import { dbg } from '../debug/debug.js';
import { SIDE, isPalaceSquare, opponent, onBank } from '../constants.js';
import { adaptiveMemory, extractFeatures } from './memory.js';
import { pieceValue, pieceSquareBonus } from './piece-values.js';
import { buildAttackMap } from './attack-map.js';
export { buildAttackMap };
const nnCache = new Map();
let nnPredictFn = null;
export const NN_CHANNELS = 24;
export const PIECE_CHANNEL = {
    king: 0, queen: 1, general: 2, elephant: 3, priest: 4, horse: 5,
    cannon: 6, tower: 7, carriage: 8, archer: 9, pawn: 10, crossbow: 11,
};
export function setNNPredictFn(fn) {
    nnPredictFn = fn;
}
export function clearNNCache() {
    nnCache.clear();
}
export function encodeBoardForNN(board) {
    const enc = new Float32Array(13 * 13 * NN_CHANNELS);
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r]?.[c];
            if (!p)
                continue;
            const ch = PIECE_CHANNEL[p.type];
            if (ch === undefined)
                continue;
            const offset = p.side === SIDE.WHITE ? 0 : 12;
            enc[(r * 13 + c) * NN_CHANNELS + offset + ch] = 1.0;
        }
    }
    return enc;
}
export function clampNNScore(nnScore) {
    if (typeof nnScore !== 'number' || Number.isNaN(nnScore) || !Number.isFinite(nnScore))
        return null;
    return Math.max(-1, Math.min(1, nnScore));
}
export function blendScoreWithNN(classicalScore, nnScore, weight = 0.15, nnCpScale = 300) {
    const clamped = clampNNScore(nnScore);
    if (clamped === null)
        return classicalScore;
    const w = Math.max(0, Math.min(1, weight));
    const nnCp = clamped * nnCpScale;
    return classicalScore * (1 - w) + nnCp * w;
}
async function getNNScore(board, side) {
    if (!nnPredictFn)
        return null;
    let fprint = `${side}:`;
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r][c];
            if (!p)
                continue;
            fprint += `${p.type[0]}${p.side[0]}${p.promoted ? 1 : 0}`;
        }
    }
    if (nnCache.has(fprint))
        return nnCache.get(fprint) ?? null;
    const enc = encodeBoardForNN(board);
    const score = await nnPredictFn(enc);
    if (score !== null)
        nnCache.set(fprint, score);
    return score;
}
const NN_WEIGHT = 0.15;
function safeRatio(a, b, neutral = 0.5) {
    const total = a + b;
    return total === 0 ? neutral : a / total;
}
export function gamePhaseFactor(board) {
    let mat = 0;
    for (const row of board)
        for (const p of row)
            if (p && p.type !== 'pawn' && p.type !== 'king')
                mat += pieceValue(p);
    return Math.min(1.0, mat / 8000);
}
function kingShieldBonus(board, kingR, kingC, side) {
    let shield = 0;
    const f = side === SIDE.WHITE ? 1 : -1;
    const dirs = [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1], [-f, -1], [-f, 0], [-f, 1]];
    for (const [dr, dc] of dirs) {
        const nr = kingR + dr, nc = kingC + dc;
        if (nr < 0 || nr >= 13 || nc < 0 || nc >= 13)
            continue;
        const p = board[nr][nc];
        if (p && p.side === side && p.type !== 'king') {
            const weight = (dr === f) ? 1.5 : 1.0;
            shield += Math.min(pieceValue(p) * 0.08 * weight, 25);
        }
    }
    return shield;
}
const HANGING_PENALTY_FACTOR = 0.85;
const DOUBLED_PAWN_PENALTY = 22;
const PAWN_ADVANCE_WEIGHT = 14;
const PALACE_PRESSURE_BONUS = 350;
const MOBILITY_WEIGHT = 9;
const TEMPO_BONUS = 15;
const KING_ATTACK_PENALTY = 400;
const KING_ESCAPE_PENALTY = 200;
const KING_SHUFFLE_PENALTY = 400;
const REPEAT_PENALTY = 1200;
const CHECKMATE_URGENCY_BASE = 200;
const CHECKMATE_URGENCY_PER = 150;
const CHECKMATE_NEARNESS_BONUS = 120;
const CHECKMATE_DEPTH_BONUS = 400;
const PAWN_CHAIN_BONUS = 25;
const PAWN_ISOLATED_PENALTY = 30;
const JUMP_REPEAT_PENALTY = 50;
const JUMP_EARLY_PENALTY = 30;
const DEV_PIECE_MOVED_BONUS = 45;
const DEV_PAWN_ADVANCED_BONUS = 35;
const DEV_UNDEVELOPED_PENALTY = 60;
const DEV_MAX_OPENING_BONUS = 300;
const DEV_URGENCE_SCALE = 0.6;
const DEV_ACTIVATION_BONUS = 30;
const DEV_PIECE_IN_PLAY_BONUS = 25;
const PALACE_DEFENSE_BONUS = 300;
const PALACE_UNDEFENDED_PEN = 500;
const PALACE_CURSE_ACTIVE_PEN = 400;
const PALACE_CURSE_PER_INVADER = 120;
const PALACE_PRE_CURSE_DANGER = 60;
const PALACE_INVASION_PENALTY = 200;
const PALACE_RECKLESS_PENALTY = 120;
const RIVER_CONTROL_BONUS = 80;
const CROSSED_RIVER_BONUS = 120;
const ADV_ADVANTAGE_THRESHOLD = 300;
const ADV_CROSSED_RIVER_BONUS = 30;
const ADV_PAWN_PUSH_BONUS = 12;
const ADV_MAX_URGENCY = 700;
const PALACE_ROWS_BLACK = [0, 1, 2];
const PALACE_ROWS_WHITE = [10, 11, 12];
const PALACE_COLS = [5, 6, 7];
const RIVER_ROW = 6;
function countPalaceInvaders(board, side) {
    const rows = side === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
    const enemy = opponent(side);
    let count = 0;
    for (const r of rows) {
        for (const c of PALACE_COLS) {
            const p = board[r][c];
            if (p && p.side === enemy)
                count++;
        }
    }
    return count;
}
function countOurInvadersInEnemyPalace(board, side) {
    const enemy = opponent(side);
    const rows = enemy === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
    let count = 0;
    for (const r of rows) {
        for (const c of PALACE_COLS) {
            const p = board[r][c];
            if (p && p.side === side && p.type !== 'king')
                count++;
        }
    }
    return count;
}
function palaceDefenseScore(ownAttackMap, enemyAttackMap, side) {
    const rows = side === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
    let defended = 0, undefended = 0;
    const ownArr = ownAttackMap._arr;
    const enemyArr = enemyAttackMap._arr;
    for (const r of rows) {
        for (const c of PALACE_COLS) {
            const i = r * 13 + c;
            const ownCoverage = ownArr[i] || 0;
            const enemyCoverage = enemyArr[i] || 0;
            if (ownCoverage > 0)
                defended++;
            if (enemyCoverage > 0 && ownCoverage === 0)
                undefended++;
        }
    }
    return defended * (PALACE_DEFENSE_BONUS / 9) - undefended * (PALACE_UNDEFENDED_PEN / 9);
}
function riverAndCrossedScore(board, side, ownAttackMap) {
    let riverCtrl = 0, crossedPieces = 0;
    const riverArr = ownAttackMap._arr;
    const riverBase = RIVER_ROW * 13;
    for (let c = 0; c < 13; c++) {
        if (riverArr[riverBase + c])
            riverCtrl++;
    }
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r][c];
            if (!p || p.side !== side)
                continue;
            if (p.type === 'king' || p.type === 'archer')
                continue;
            const crossed = side === SIDE.BLACK ? (r >= 7) : (r <= 5);
            if (crossed)
                crossedPieces++;
        }
    }
    return riverCtrl * (RIVER_CONTROL_BONUS / 13) + crossedPieces * (CROSSED_RIVER_BONUS / 5);
}
function reserveValue(state, side) {
    return state.reserves[side].reduce((s, p) => {
        const urgency = p.type === 'tower' ? 1.6
            : p.type === 'general' ? 1.6
                : p.type === 'crossbow' ? 1.4
                    : 1.0;
        return s + pieceValue(p) * urgency;
    }, 0);
}
function palaceDangerAdjustment(state, side) {
    const curse = state.palaceCurse?.[side];
    const board = state.board;
    let adjustment = 0;
    const invaderCount = countPalaceInvaders(board, side);
    if (invaderCount > 0) {
        adjustment -= PALACE_INVASION_PENALTY;
        if (curse?.active) {
            adjustment -= PALACE_CURSE_ACTIVE_PEN;
            adjustment -= invaderCount * PALACE_CURSE_PER_INVADER;
        }
        else if (curse) {
            const turns = curse.turnsInPalace ?? 0;
            adjustment -= turns * PALACE_PRE_CURSE_DANGER;
        }
    }
    return adjustment;
}
function recklessInvasionPenalty(state, side) {
    const ourInvaders = countOurInvadersInEnemyPalace(state.board, side);
    const enemyCurse = state.palaceCurse?.[opponent(side)];
    if (ourInvaders === 0)
        return 0;
    let penalty = 0;
    if (enemyCurse?.active) {
        penalty += ourInvaders * PALACE_CURSE_PER_INVADER * 2;
    }
    else if (enemyCurse && enemyCurse.turnsInPalace > 0) {
        penalty += ourInvaders * PALACE_RECKLESS_PENALTY;
    }
    return penalty;
}
function checkmateUrgencyScore(board, side, enemyKingPos, ownMap, enemyMap, phaseFactor) {
    if (!enemyKingPos)
        return 0;
    const endgameUrgency = 1 - phaseFactor;
    let attackers = 0;
    let escapeSqUnderAttack = 0;
    const kRow = enemyKingPos.r, kCol = enemyKingPos.c;
    const kingAdj = [[kRow - 1, kCol - 1], [kRow - 1, kCol], [kRow - 1, kCol + 1], [kRow, kCol - 1], [kRow, kCol + 1], [kRow + 1, kCol - 1], [kRow + 1, kCol], [kRow + 1, kCol + 1]];
    const ownArr = ownMap.attackMap._arr;
    for (let r = Math.max(0, kRow - 3); r <= Math.min(12, kRow + 3); r++) {
        for (let c = Math.max(0, kCol - 3); c <= Math.min(12, kCol + 3); c++) {
            if (ownArr[r * 13 + c]) {
                const p = board[r][c];
                if (p && p.side === side)
                    attackers++;
            }
        }
    }
    for (const [er, ec] of kingAdj) {
        if (er >= 0 && er < 13 && ec >= 0 && ec < 13) {
            if (ownArr[er * 13 + ec])
                escapeSqUnderAttack++;
        }
    }
    let urgency = attackers * CHECKMATE_URGENCY_PER + escapeSqUnderAttack * CHECKMATE_NEARNESS_BONUS;
    if (attackers > 0)
        urgency += CHECKMATE_URGENCY_BASE;
    if (endgameUrgency > 0.7)
        urgency += CHECKMATE_DEPTH_BONUS;
    return Math.round(urgency * (0.5 + endgameUrgency * 0.5));
}
function pawnStructureScore(board, side) {
    const pawnPositions = [];
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r][c];
            if (p && p.side === side && p.type === 'pawn')
                pawnPositions.push({ r, c });
        }
    }
    if (pawnPositions.length < 2)
        return 0;
    let chainBonus = 0, isolatedPenalty = 0;
    const colPresence = new Set();
    for (const pos of pawnPositions)
        colPresence.add(pos.c);
    for (const pos of pawnPositions) {
        let isChain = false;
        for (const other of pawnPositions) {
            if (other.r === pos.r && other.c === pos.c)
                continue;
            if (Math.abs(other.r - pos.r) === 1 && Math.abs(other.c - pos.c) === 1) {
                isChain = true;
                break;
            }
        }
        if (isChain)
            chainBonus++;
        let hasNeighbor = false;
        for (const adjCol of [pos.c - 1, pos.c + 1]) {
            if (colPresence.has(adjCol)) {
                hasNeighbor = true;
                break;
            }
        }
        if (!hasNeighbor)
            isolatedPenalty++;
    }
    return chainBonus * PAWN_CHAIN_BONUS - isolatedPenalty * PAWN_ISOLATED_PENALTY;
}
function jumpingPieceOverusePenalty(board, side, phaseFactor) {
    const isBlack = side === SIDE.BLACK;
    const homeBackRank = isBlack ? 0 : 12;
    const JUMP_TYPES = new Set(['cannon', 'carriage', 'general']);
    let jumpPiecesMoved = 0, normalPiecesDeveloped = 0;
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r][c];
            if (!p || p.side !== side || p.type === 'king')
                continue;
            if (p.type === 'pawn')
                continue;
            if (JUMP_TYPES.has(p.type)) {
                if (r !== homeBackRank)
                    jumpPiecesMoved++;
            }
            else {
                if (r !== homeBackRank)
                    normalPiecesDeveloped++;
            }
        }
    }
    let penalty = 0;
    const openingUrgency = Math.max(0, 1 - phaseFactor);
    if (jumpPiecesMoved > 0 && normalPiecesDeveloped < 1) {
        penalty += (1 - normalPiecesDeveloped) * JUMP_EARLY_PENALTY;
    }
    if (jumpPiecesMoved > normalPiecesDeveloped && normalPiecesDeveloped > 0) {
        penalty += (jumpPiecesMoved - normalPiecesDeveloped) * JUMP_REPEAT_PENALTY;
    }
    return Math.round(penalty * openingUrgency);
}
function countInminentPalaceInvasion(state, side, ownMap, enemyMap) {
    const enemy = opponent(side);
    let count = 0;
    const arr = ownMap.attackMap._arr;
    for (let _i = 0; _i < 169; _i++) {
        if (!arr[_i])
            continue;
        const r = (_i / 13) | 0, c = _i % 13;
        if (isPalaceSquare(r, c, enemy)) {
            const target = state.board[r]?.[c];
            if (!target || target.side !== side)
                count++;
        }
    }
    return count;
}
function developmentScore(board, side, phaseFactor) {
    const openingUrgency = 1 - phaseFactor;
    const devWeight = Math.pow(openingUrgency, DEV_URGENCE_SCALE * 2 + 0.4);
    if (devWeight < 0.05)
        return 0;
    const isBlack = side === SIDE.BLACK;
    const homeBackRank = isBlack ? 0 : 12;
    const homePawnRank = isBlack ? 2 : 10;
    let movedPieces = 0, undeveloped = 0, pawnsAdvanced = 0, pawnsOnHome = 0;
    let piecesInEnemyTerritory = 0, piecesActive = 0;
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r][c];
            if (!p || p.side !== side)
                continue;
            if (p.type === 'king')
                continue;
            if (p.type === 'pawn') {
                const advance = isBlack ? r - homePawnRank : homePawnRank - r;
                if (advance > 0)
                    pawnsAdvanced++;
                else if (advance === 0)
                    pawnsOnHome++;
                if (isBlack ? (r >= 7) : (r <= 5))
                    piecesInEnemyTerritory++;
            }
            else {
                if (r === homeBackRank)
                    undeveloped++;
                else {
                    movedPieces++;
                    piecesActive++;
                    if (isBlack ? (r >= 7) : (r <= 5))
                        piecesInEnemyTerritory++;
                }
            }
        }
    }
    let devScore = movedPieces * DEV_PIECE_MOVED_BONUS + pawnsAdvanced * DEV_PAWN_ADVANCED_BONUS
        + piecesActive * DEV_ACTIVATION_BONUS / 2 + piecesInEnemyTerritory * DEV_ACTIVATION_BONUS
        - undeveloped * DEV_UNDEVELOPED_PENALTY;
    devScore = Math.max(0, Math.min(DEV_MAX_OPENING_BONUS, devScore));
    return Math.round(devScore * devWeight);
}
function kingSafetyFast(state, side, ownByPiece, enemyAttackMap, phaseFactor, kingPos) {
    if (!kingPos)
        return -5000;
    const _ki = kingPos.r * 13 + kingPos.c;
    const attacks = enemyAttackMap._arr[_ki] || 0;
    const escapes = ownByPiece._arr[_ki] || 0;
    let score = 120;
    score += isPalaceSquare(kingPos.r, kingPos.c, side) ? 25 : -65;
    if (state.palaceTaken?.[side])
        score -= 90;
    score -= Math.min(3, attacks) * KING_ATTACK_PENALTY * phaseFactor;
    if (escapes < 3)
        score -= ((3 - escapes) * KING_ESCAPE_PENALTY) * phaseFactor;
    score += kingShieldBonus(state.board, kingPos.r, kingPos.c, side) * phaseFactor;
    return score;
}
function repetitionPenalty(hash, history) {
    let seen = 0;
    for (const h of history)
        if (h === hash)
            seen++;
    return Math.max(0, seen - 1) * REPEAT_PENALTY;
}
function kingRecentMovePenalty(state) {
    const last = state.lastMove;
    if (!last?.from || !last?.to)
        return 0;
    const mp = state.board?.[last.to.r]?.[last.to.c];
    if (!mp || mp.type !== 'king')
        return 0;
    let pen = KING_SHUFFLE_PENALTY * 0.35;
    if (isPalaceSquare(last.from.r, last.from.c, mp.side) && !isPalaceSquare(last.to.r, last.to.c, mp.side))
        pen += 60;
    if (!isPalaceSquare(last.to.r, last.to.c, mp.side))
        pen += 35;
    return mp.side === SIDE.BLACK ? -pen : pen;
}
export function evaluate(state, hash, precomputedMaps = null, skipMemory = false) {
    const t = dbg.perf.start('evaluate');
    const board = state.board;
    const phaseFactor = gamePhaseFactor(board);
    const endgame = 1 - phaseFactor;
    const blackMap = precomputedMaps?.black ?? buildAttackMap(board, SIDE.BLACK);
    const whiteMap = precomputedMaps?.white ?? buildAttackMap(board, SIDE.WHITE);
    let score = 0, blackMaterial = 0, whiteMaterial = 0;
    const blackPawnCols = Array(13).fill(0), whitePawnCols = Array(13).fill(0);
    let blackPalacePressure = 0, whitePalacePressure = 0, blackCenterCtrl = 0, whiteCenterCtrl = 0;
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const piece = board[r][c];
            if (!piece)
                continue;
            const isBlack = piece.side === SIDE.BLACK;
            const ownMap = isBlack ? blackMap : whiteMap;
            const enemyMap = isBlack ? whiteMap : blackMap;
            const _cellIdx = r * 13 + c;
            const attacks = enemyMap.attackMap._arr[_cellIdx] || 0;
            const mob = ownMap.byPiece._arr[_cellIdx] || 0;
            const val = pieceValue(piece);
            let local = val + pieceSquareBonus(piece, r, c);
            if (isBlack)
                blackMaterial += val;
            else
                whiteMaterial += val;
            if (attacks > 0) {
                let h = val * HANGING_PENALTY_FACTOR * attacks;
                if (attacks > 1)
                    h += val * 0.12 * (attacks - 1);
                if (mob === 0)
                    h += val * 0.16;
                local -= Math.min(val * 0.9, h);
            }
            if (mob === 0 && piece.type !== 'king')
                local -= 14;
            score += isBlack ? local : -local;
            const enemy = isBlack ? SIDE.WHITE : SIDE.BLACK;
            if (isPalaceSquare(r, c, enemy)) {
                if (isBlack)
                    blackPalacePressure += 50;
                else
                    whitePalacePressure += 110;
            }
            if (['tower', 'queen', 'cannon'].includes(piece.type)) {
                const palCenter = enemy === SIDE.BLACK ? 1 : 11;
                const dist = Math.abs(r - palCenter);
                if (dist <= 4) {
                    const pb = (5 - Math.min(4, dist)) * 25;
                    if (isBlack)
                        blackPalacePressure += pb;
                    else
                        whitePalacePressure += pb;
                }
            }
            if (piece.type === 'pawn') {
                const progress = isBlack ? r : (12 - r);
                const pawnScore = progress * PAWN_ADVANCE_WEIGHT * (1 + endgame);
                const crossed = isBlack ? (r >= 7) : (r <= 5);
                const ps = pawnScore + (crossed ? 12 * (1 + endgame) : 0) + (piece.promoted ? 24 : 0);
                score += isBlack ? ps : -ps;
                if (isBlack)
                    blackPawnCols[c]++;
                else
                    whitePawnCols[c]++;
            }
            if (piece.type === 'archer' && onBank(piece.side, r)) {
                const dir = piece.side === SIDE.WHITE ? 1 : -1;
                let blockedCount = 0, blocksPalace = false;
                let shieldedAllies = 0, shieldedHighValue = 0;
                for (const dc of [-1, 0, 1]) {
                    const nr = r + dir, nc = c + dc;
                    if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
                        blockedCount++;
                        if (isPalaceSquare(nr, nc, enemy))
                            blocksPalace = true;
                        const sheltered = board[nr][nc];
                        if (sheltered && sheltered.side === piece.side && sheltered.type !== 'king') {
                            shieldedAllies++;
                            if (pieceValue(sheltered) >= 450)
                                shieldedHighValue++;
                        }
                    }
                }
                const sign = piece.side === SIDE.BLACK ? 1 : -1;
                score += sign * blockedCount * 40;
                if (blocksPalace)
                    score += sign * 120;
                score += sign * shieldedAllies * 60 * (0.5 + phaseFactor * 0.5);
                score += sign * shieldedHighValue * 50 * (0.5 + phaseFactor * 0.5);
            }
        }
    }
    for (let c = 0; c < 13; c++) {
        if (blackPawnCols[c] > 1)
            score -= (blackPawnCols[c] - 1) * DOUBLED_PAWN_PENALTY;
        if (whitePawnCols[c] > 1)
            score += (whitePawnCols[c] - 1) * DOUBLED_PAWN_PENALTY;
    }
    score += blackPalacePressure - whitePalacePressure;
    {
        const arr = blackMap.attackMap._arr;
        for (let _i = 0; _i < 169; _i++) {
            if (!arr[_i])
                continue;
            const r = (_i / 13) | 0, c = _i % 13, v = arr[_i];
            if (r >= 4 && r <= 8 && c >= 4 && c <= 8)
                blackCenterCtrl += v;
            if (r >= 10 && c >= 5 && c <= 7)
                blackCenterCtrl += v * 5;
        }
    }
    {
        const arr = whiteMap.attackMap._arr;
        for (let _i = 0; _i < 169; _i++) {
            if (!arr[_i])
                continue;
            const r = (_i / 13) | 0, c = _i % 13, v = arr[_i];
            if (r >= 4 && r <= 8 && c >= 4 && c <= 8)
                whiteCenterCtrl += v;
            if (r <= 2 && c >= 5 && c <= 7)
                whiteCenterCtrl += v * 5;
        }
    }
    score += blackCenterCtrl - whiteCenterCtrl;
    let blackValuableAttacked = 0, whiteValuableAttacked = 0;
    {
        const arr = blackMap.attackMap._arr;
        for (let _i = 0; _i < 169; _i++) {
            if (!arr[_i])
                continue;
            const r = (_i / 13) | 0, c = _i % 13;
            const target = board[r]?.[c];
            if (target && target.side !== SIDE.BLACK && pieceValue(target) > 300)
                blackValuableAttacked++;
        }
    }
    {
        const arr = whiteMap.attackMap._arr;
        for (let _i = 0; _i < 169; _i++) {
            if (!arr[_i])
                continue;
            const r = (_i / 13) | 0, c = _i % 13;
            const target = board[r]?.[c];
            if (target && target.side !== SIDE.WHITE && pieceValue(target) > 300)
                whiteValuableAttacked++;
        }
    }
    score += Math.min(blackValuableAttacked * 8, 30);
    score -= Math.min(whiteValuableAttacked * 8, 30);
    const materialAdv = blackMaterial - whiteMaterial;
    const blackReserveVal = reserveValue(state, SIDE.BLACK);
    const whiteReserveVal = reserveValue(state, SIDE.WHITE);
    const whiteThreatMult = materialAdv > 150 ? 1.0 + Math.min(materialAdv / 2000, 0.8) : 1.0;
    const blackThreatMult = materialAdv < -150 ? 1.0 + Math.min(-materialAdv / 2000, 0.8) : 1.0;
    score += blackReserveVal * blackThreatMult - whiteReserveVal * whiteThreatMult;
    score += (state.reserves.black.length * 15 * blackThreatMult) - (state.reserves.white.length * 15 * whiteThreatMult);
    score += (blackMap.mobilityCount.total - whiteMap.mobilityCount.total) * MOBILITY_WEIGHT;
    let blackAdvUrgency = 0, whiteAdvUrgency = 0;
    if (materialAdv > ADV_ADVANTAGE_THRESHOLD) {
        for (let r = 0; r < 13; r++) {
            for (let c = 0; c < 13; c++) {
                const p = board[r][c];
                if (!p || p.side !== SIDE.BLACK)
                    continue;
                if (p.type === 'king')
                    continue;
                if (p.type !== 'pawn') {
                    if (r <= 5)
                        blackAdvUrgency += ADV_CROSSED_RIVER_BONUS;
                }
                else {
                    blackAdvUrgency += r * ADV_PAWN_PUSH_BONUS / 3;
                }
            }
        }
        blackAdvUrgency = Math.min(ADV_MAX_URGENCY, Math.round(blackAdvUrgency * (materialAdv / 2000)));
    }
    if (materialAdv < -ADV_ADVANTAGE_THRESHOLD) {
        for (let r = 0; r < 13; r++) {
            for (let c = 0; c < 13; c++) {
                const p = board[r][c];
                if (!p || p.side !== SIDE.WHITE)
                    continue;
                if (p.type === 'king')
                    continue;
                if (p.type !== 'pawn') {
                    if (r >= 7)
                        whiteAdvUrgency += ADV_CROSSED_RIVER_BONUS;
                }
                else {
                    const advance = 12 - r;
                    whiteAdvUrgency += advance * ADV_PAWN_PUSH_BONUS / 3;
                }
            }
        }
        whiteAdvUrgency = Math.min(ADV_MAX_URGENCY, Math.round(whiteAdvUrgency * (-materialAdv / 2000)));
    }
    score += blackAdvUrgency - whiteAdvUrgency;
    const blackKS = kingSafetyFast(state, SIDE.BLACK, blackMap.byPiece, whiteMap.attackMap, phaseFactor, blackMap.kingPos);
    const whiteKS = kingSafetyFast(state, SIDE.WHITE, whiteMap.byPiece, blackMap.attackMap, phaseFactor, whiteMap.kingPos);
    score += blackKS - whiteKS;
    const blackDanger = palaceDangerAdjustment(state, SIDE.BLACK);
    const whiteDanger = palaceDangerAdjustment(state, SIDE.WHITE);
    score += blackDanger - whiteDanger;
    score -= recklessInvasionPenalty(state, SIDE.BLACK);
    score += recklessInvasionPenalty(state, SIDE.WHITE);
    if (state.palaceTaken?.black)
        score += 350;
    if (state.palaceTaken?.white)
        score -= 350;
    const blackInvasion = countInminentPalaceInvasion(state, SIDE.BLACK, blackMap, whiteMap);
    const whiteInvasion = countInminentPalaceInvasion(state, SIDE.WHITE, whiteMap, blackMap);
    score += blackInvasion * 55;
    score -= whiteInvasion * 55;
    const blackPalaceDef = palaceDefenseScore(blackMap.attackMap, whiteMap.attackMap, SIDE.BLACK);
    const whitePalaceDef = palaceDefenseScore(whiteMap.attackMap, blackMap.attackMap, SIDE.WHITE);
    score += blackPalaceDef - whitePalaceDef;
    const blackRiver = riverAndCrossedScore(board, SIDE.BLACK, blackMap.attackMap);
    const whiteRiver = riverAndCrossedScore(board, SIDE.WHITE, whiteMap.attackMap);
    score += blackRiver - whiteRiver;
    const blackDev = developmentScore(board, SIDE.BLACK, phaseFactor);
    const whiteDev = developmentScore(board, SIDE.WHITE, phaseFactor);
    score += blackDev - whiteDev;
    const blackMateUrgency = checkmateUrgencyScore(board, SIDE.BLACK, whiteMap.kingPos, blackMap, whiteMap, phaseFactor);
    const whiteMateUrgency = checkmateUrgencyScore(board, SIDE.WHITE, blackMap.kingPos, whiteMap, blackMap, phaseFactor);
    score += blackMateUrgency - whiteMateUrgency;
    const blackPawnStruct = pawnStructureScore(board, SIDE.BLACK);
    const whitePawnStruct = pawnStructureScore(board, SIDE.WHITE);
    score += blackPawnStruct - whitePawnStruct;
    score -= jumpingPieceOverusePenalty(board, SIDE.BLACK, phaseFactor);
    score += jumpingPieceOverusePenalty(board, SIDE.WHITE, phaseFactor);
    dbg.ai.group('eval:full', {
        blackDev: blackDev, whiteDev: whiteDev,
        blackPalaceDef: blackPalaceDef.toFixed(1), whitePalaceDef: whitePalaceDef.toFixed(1),
        palaceNet: (blackPalaceDef - whitePalaceDef).toFixed(1),
        blackRiver: blackRiver.toFixed(1), whiteRiver: whiteRiver.toFixed(1),
        riverNet: (blackRiver - whiteRiver).toFixed(1),
        blackReserveVal: blackReserveVal.toFixed(1), whiteReserveVal: whiteReserveVal.toFixed(1),
        whiteThreatMult: whiteThreatMult.toFixed(2), blackThreatMult: blackThreatMult.toFixed(2),
        palaceTaken: `B:${state.palaceTaken?.black ? 'YES' : 'no'} W:${state.palaceTaken?.white ? 'YES' : 'no'}`,
        palaceCurse: `B:${state.palaceCurse?.black?.active ? `ACTIVE(${state.palaceCurse.black.turnsInPalace}t)` : state.palaceCurse?.black?.turnsInPalace > 0 ? `TICKING(${state.palaceCurse.black.turnsInPalace}t)` : 'off'} W:${state.palaceCurse?.white?.active ? `ACTIVE(${state.palaceCurse.white.turnsInPalace}t)` : state.palaceCurse?.white?.turnsInPalace > 0 ? `TICKING(${state.palaceCurse.white.turnsInPalace}t)` : 'off'}`,
        blackDanger: blackDanger.toFixed(1), whiteDanger: whiteDanger.toFixed(1),
    });
    score += state.turn === SIDE.BLACK ? TEMPO_BONUS : -TEMPO_BONUS;
    score += kingRecentMovePenalty(state);
    score -= repetitionPenalty(hash, Array.isArray(state.history) ? state.history : []);
    const metrics = {
        palacePressure: safeRatio(blackPalacePressure, whitePalacePressure),
        pieceActivity: safeRatio(blackMap.mobilityCount.total, whiteMap.mobilityCount.total),
        materialBalance: safeRatio(blackMaterial, whiteMaterial),
        kingSafety: safeRatio(blackKS + 500, whiteKS + 500),
        centerControl: safeRatio(blackCenterCtrl, whiteCenterCtrl),
        palaceDefense: safeRatio(blackPalaceDef + 100, whitePalaceDef + 100),
        riverControl: safeRatio(blackRiver + 1, whiteRiver + 1),
    };
    score += adaptiveMemory.applyWeights(metrics);
    if (!skipMemory && !precomputedMaps) {
        const blackFk = extractFeatures(state, SIDE.BLACK);
        const whiteFk = extractFeatures(state, SIDE.WHITE);
        score += adaptiveMemory.getFeatureScore(blackFk, phaseFactor);
        score -= adaptiveMemory.getFeatureScore(whiteFk, phaseFactor);
    }
    dbg.perf.end(t);
    return { score, metrics };
}
