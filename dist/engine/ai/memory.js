import { SIDE, isPalaceSquare, onBank } from '../constants.ts';
import { findKings } from '../rules/board.ts';
const LEARNING_RATE = 0.12;
const MAX_MEMORY_SIZE = 3000;
const MAX_MOVE_MEMORY = 4000;
const BLUNDER_THRESHOLD = 200;
const MISTAKE_THRESHOLD = 80;
const DECAY_RATE = 0.02;
export function extractFeatures(state, side) {
    const enemy = side === SIDE.BLACK ? SIDE.WHITE : SIDE.BLACK;
    const board = state.board;
    let archerOnBank = 0, palacePressure = 0;
    let reserveCount = state.reserves[side].length;
    let enemyReserveCount = state.reserves[enemy].length;
    let palaceTaken = state.palaceTaken?.[side] ? 1 : 0;
    let enemyPalaceTaken = state.palaceTaken?.[enemy] ? 1 : 0;
    let curseActive = state.palaceCurse?.[side]?.active ? 1 : 0;
    let enemyCurseActive = state.palaceCurse?.[enemy]?.active ? 1 : 0;
    let ownCrossed = 0, enemyCrossed = 0;
    let ownArchers = 0, enemyArchers = 0;
    let ownHeavy = 0, enemyHeavy = 0;
    let ownTowers = 0, enemyTowers = 0;
    let ownCannons = 0, enemyCannons = 0;
    let kingOutsidePalace = 0, enemyKingOutsidePalace = 0;
    let ownCenterCtrl = 0, enemyCenterCtrl = 0;
    let ownPalaceDef = 0, enemyPalaceDef = 0;
    let ownPromoted = 0, enemyPromoted = 0;
    let ownAdvPawns = 0, enemyAdvPawns = 0;
    let ownNearPromo = 0, enemyNearPromo = 0;
    let ownKingCol = -1, enemyKingCol = -1;
    let kingsFacing = 0;
    const kings = findKings(board);
    if (kings?.[side] && kings?.[enemy]) {
        const k1 = kings[side], k2 = kings[enemy];
        ownKingCol = k1.c;
        enemyKingCol = k2.c;
        const dr = Math.sign(k2.r - k1.r);
        const dc = Math.sign(k2.c - k1.c);
        const sameRow = dr === 0 && dc !== 0;
        const sameCol = dc === 0 && dr !== 0;
        const sameDiag = dr !== 0 && dc !== 0 && Math.abs(k2.r - k1.r) === Math.abs(k2.c - k1.c);
        if (sameRow || sameCol || sameDiag) {
            let clear = true;
            let cr = k1.r + dr, cc = k1.c + dc;
            while (cr !== k2.r || cc !== k2.c) {
                if (board[cr]?.[cc]) {
                    clear = false;
                    break;
                }
                cr += dr;
                cc += dc;
            }
            if (clear)
                kingsFacing = 1;
        }
    }
    let ownTowersInReserve = 0, ownGeneralsInReserve = 0, ownPawnsInReserve = 0;
    let enemyTowersInReserve = 0, enemyGeneralsInReserve = 0, enemyPawnsInReserve = 0;
    for (const p of state.reserves[side] || []) {
        if (p.type === 'tower')
            ownTowersInReserve++;
        else if (p.type === 'general')
            ownGeneralsInReserve++;
        else if (p.type === 'pawn' || p.type === 'crossbow')
            ownPawnsInReserve++;
    }
    for (const p of state.reserves[enemy] || []) {
        if (p.type === 'tower')
            enemyTowersInReserve++;
        else if (p.type === 'general')
            enemyGeneralsInReserve++;
        else if (p.type === 'pawn' || p.type === 'crossbow')
            enemyPawnsInReserve++;
    }
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const p = board[r][c];
            if (!p)
                continue;
            if (p.side === side) {
                if (p.type === 'king') {
                    if (!isPalaceSquare(r, c, side))
                        kingOutsidePalace = 1;
                }
                else {
                    if (p.type === 'archer') {
                        ownArchers++;
                        if (onBank(side, r))
                            archerOnBank++;
                    }
                    else if (p.type === 'tower')
                        ownTowers++;
                    else if (p.type === 'cannon')
                        ownCannons++;
                    else if (['queen', 'general'].includes(p.type))
                        ownHeavy++;
                    const crossed = side === SIDE.BLACK ? (r <= 5) : (r >= 7);
                    if (crossed)
                        ownCrossed++;
                    if (isPalaceSquare(r, c, enemy))
                        palacePressure++;
                    const centerDist = Math.abs(r - 6) + Math.abs(c - 6);
                    if (centerDist <= 4)
                        ownCenterCtrl++;
                    if (isPalaceSquare(r, c, side))
                        ownPalaceDef++;
                    if (p.promoted)
                        ownPromoted++;
                    if (p.type === 'pawn' && !p.promoted) {
                        const fromOwn = side === SIDE.WHITE ? r : 12 - r;
                        if (fromOwn >= 5)
                            ownAdvPawns++;
                        const inPromoZone = side === SIDE.BLACK ? r >= 10 : r <= 2;
                        if (inPromoZone)
                            ownNearPromo++;
                    }
                }
            }
            else {
                if (p.type === 'king') {
                    if (!isPalaceSquare(r, c, enemy))
                        enemyKingOutsidePalace = 1;
                }
                else {
                    if (p.type === 'archer')
                        enemyArchers++;
                    else if (p.type === 'tower')
                        enemyTowers++;
                    else if (p.type === 'cannon')
                        enemyCannons++;
                    else if (['queen', 'general'].includes(p.type))
                        enemyHeavy++;
                    const crossed = enemy === SIDE.BLACK ? (r <= 5) : (r >= 7);
                    if (crossed)
                        enemyCrossed++;
                    const centerDist = Math.abs(r - 6) + Math.abs(c - 6);
                    if (centerDist <= 4)
                        enemyCenterCtrl++;
                    if (isPalaceSquare(r, c, enemy))
                        enemyPalaceDef++;
                    if (p.promoted)
                        enemyPromoted++;
                    if (p.type === 'pawn' && !p.promoted) {
                        const fromOwn = enemy === SIDE.WHITE ? r : 12 - r;
                        if (fromOwn >= 5)
                            enemyAdvPawns++;
                        const inPromoZone = enemy === SIDE.BLACK ? r >= 10 : r <= 2;
                        if (inPromoZone)
                            enemyNearPromo++;
                    }
                }
            }
        }
    }
    const parts = [
        'ap:', archerOnBank, '|pp:', Math.min(palacePressure, 3), '|r:', reserveCount,
        '|er:', enemyReserveCount, '|pt:', palaceTaken, '|ept:', enemyPalaceTaken,
        '|cu:', curseActive, '|ecu:', enemyCurseActive, '|ko:', kingOutsidePalace,
        '|eko:', enemyKingOutsidePalace, '|ac:', ownArchers, '|eac:', enemyArchers,
        '|hv:', Math.min(ownHeavy, 3), '|ehv:', Math.min(enemyHeavy, 3),
        '|xc:', Math.min(ownCrossed, 5), '|exc:', Math.min(enemyCrossed, 5),
        '|cc:', Math.min(ownCenterCtrl, 3), '|ecc:', Math.min(enemyCenterCtrl, 3),
        '|pd:', Math.min(ownPalaceDef, 3), '|epd:', Math.min(enemyPalaceDef, 3),
        '|kf:', kingsFacing, '|tw:', Math.min(ownTowers, 2), '|etw:', Math.min(enemyTowers, 2),
        '|cn:', Math.min(ownCannons, 2), '|ecn:', Math.min(enemyCannons, 2),
        '|pro:', Math.min(ownPromoted, 3), '|epro:', Math.min(enemyPromoted, 3),
        '|apw:', Math.min(ownAdvPawns, 3), '|eapw:', Math.min(enemyAdvPawns, 3),
        '|npz:', ownNearPromo, '|enpz:', enemyNearPromo,
        '|rtr:', ownTowersInReserve, '|rgr:', ownGeneralsInReserve, '|rpr:', ownPawnsInReserve,
        '|ertr:', enemyTowersInReserve, '|ergr:', enemyGeneralsInReserve, '|erpr:', enemyPawnsInReserve,
        '|krc:', ownKingCol, '|ekc:', enemyKingCol,
    ];
    return parts.join('');
}
export class AdaptiveMemory {
    moveScores;
    featureScores;
    blunderMoves;
    drawPositions;
    maxDrawCount;
    patternWeights;
    gamesPlayed;
    gamesWon;
    constructor() {
        this.moveScores = new Map();
        this.featureScores = new Map();
        this.blunderMoves = new Map();
        this.drawPositions = new Map();
        this.maxDrawCount = 5;
        this.patternWeights = {
            centerControl: 1.0, pieceActivity: 1.0, kingSafety: 1.0,
            materialBalance: 1.0, pawnStructure: 1.0, palacePressure: 1.0,
            position: 1.0, piecePlacement: 1.0, palaceDefence: 1.0, riverControl: 1.0
        };
        this.gamesPlayed = 0;
        this.gamesWon = 0;
    }
    recordDrawGame(moves, drawStatus = 'draw') {
        if (!moves || moves.length === 0)
            return;
        const weight = drawStatus === 'draw_move_limit' ? 2 : 1;
        const seenHashes = new Set();
        for (const m of moves) {
            if (m.positionHash)
                seenHashes.add(m.positionHash);
        }
        for (const hash of seenHashes) {
            const count = (this.drawPositions.get(hash) || 0) + weight;
            if (count <= this.maxDrawCount)
                this.drawPositions.set(hash, count);
        }
        if (this.drawPositions.size > 20000) {
            const entries = [...this.drawPositions.entries()].sort((a, b) => a[1] - b[1]);
            const toDelete = entries.slice(0, 5000);
            for (const [h] of toDelete)
                this.drawPositions.delete(h);
        }
    }
    getDrawPenalty(hash) {
        if (!hash)
            return 0;
        const count = this.drawPositions.get(hash) || 0;
        if (count === 0)
            return 0;
        return Math.min(count * 70, 800);
    }
    recordGame(result, moves) {
        this.gamesPlayed++;
        if (result === 'win')
            this.gamesWon++;
        if (!moves || moves.length === 0)
            return;
        for (const [, val] of this.moveScores) {
            val.total *= (1 - DECAY_RATE);
            val.count *= (1 - DECAY_RATE * 0.5);
        }
        for (const [, val] of this.featureScores) {
            val.total *= (1 - DECAY_RATE);
            val.count *= (1 - DECAY_RATE * 0.5);
        }
        for (const [key, val] of this.blunderMoves) {
            this.blunderMoves.set(key, val * (1 - DECAY_RATE));
        }
        for (const m of moves) {
            if (!m)
                continue;
            const mk = m.moveKeyStr ?? m.positionKey ?? null;
            const fk = m.featureKey ?? null;
            const evalBefore = m.evalBefore ?? null;
            const evalAfter = m.evalAfter ?? null;
            if (mk !== null && evalBefore !== null && evalAfter !== null) {
                const side = m.side ?? SIDE.BLACK;
                const sign = side === SIDE.BLACK ? 1 : -1;
                const delta = (evalAfter - evalBefore) * sign;
                const prev = this.moveScores.get(mk) ?? { total: 0, count: 0 };
                prev.total += delta;
                prev.count++;
                this.moveScores.set(mk, prev);
                if (delta <= -BLUNDER_THRESHOLD) {
                    const pen = this.blunderMoves.get(mk) ?? 0;
                    this.blunderMoves.set(mk, pen + Math.abs(delta));
                }
                else if (delta <= -MISTAKE_THRESHOLD) {
                    const pen = this.blunderMoves.get(mk) ?? 0;
                    this.blunderMoves.set(mk, pen + Math.abs(delta) * 0.4);
                }
            }
            if (fk !== null) {
                const delta = result === 'win' ? 1 : result === 'loss' ? -1 : 0;
                const prev = this.featureScores.get(fk) ?? { total: 0, count: 0 };
                prev.total += delta;
                prev.count++;
                this.featureScores.set(fk, prev);
            }
        }
        this._adjustWeights(result, moves);
        this._prune();
    }
    getMovepenalty(mk) {
        if (!mk)
            return 0;
        const blunder = this.blunderMoves.get(mk) ?? 0;
        if (blunder > 0)
            return Math.min(blunder * 0.15, 120);
        const ms = this.moveScores.get(mk);
        if (!ms || ms.count < 2)
            return 0;
        const avg = ms.total / ms.count;
        if (avg < -50)
            return Math.min(Math.abs(avg) * 0.2, 80);
        return 0;
    }
    getFeatureScore(featureKey, phaseFactor) {
        if (!featureKey)
            return 0;
        const d = this.featureScores.get(featureKey);
        if (!d || d.count < 4)
            return 0;
        return (d.total / d.count) * 30 * (0.3 + phaseFactor * 0.7);
    }
    applyWeights(metrics) {
        return ((metrics.palacePressure - 0.5) * this.patternWeights.palacePressure * 30 +
            (metrics.kingSafety - 0.5) * this.patternWeights.kingSafety * 22 +
            (metrics.materialBalance - 0.5) * this.patternWeights.materialBalance * 12 +
            (metrics.pieceActivity - 0.5) * this.patternWeights.pieceActivity * 14 +
            (metrics.centerControl - 0.5) * this.patternWeights.centerControl * 10);
    }
    _adjustWeights(result, moves) {
        const factor = result === 'win' ? 1 + LEARNING_RATE : result === 'loss' ? 1 - LEARNING_RATE * 0.5 : 1;
        let cc = 0, pa = 0, ks = 0, mb = 0, pp = 0, n = 0;
        for (const m of moves) {
            if (!m?.metrics)
                continue;
            cc += m.metrics.centerControl ?? 0;
            pa += m.metrics.pieceActivity ?? 0;
            ks += m.metrics.kingSafety ?? 0;
            mb += m.metrics.materialBalance ?? 0;
            pp += m.metrics.palacePressure ?? 0;
            n++;
        }
        if (n === 0)
            return;
        const clamp = (v) => Math.min(2, Math.max(0.3, v));
        const adj = (avg) => Math.abs(avg - 0.5) > 0.08;
        if (adj(cc / n))
            this.patternWeights.centerControl = clamp(this.patternWeights.centerControl * factor);
        if (adj(pa / n))
            this.patternWeights.pieceActivity = clamp(this.patternWeights.pieceActivity * factor);
        if (adj(ks / n))
            this.patternWeights.kingSafety = clamp(this.patternWeights.kingSafety * factor);
        if (adj(mb / n))
            this.patternWeights.materialBalance = clamp(this.patternWeights.materialBalance * factor);
        if (adj(pp / n))
            this.patternWeights.palacePressure = clamp(this.patternWeights.palacePressure * factor);
        const total = Object.values(this.patternWeights).reduce((a, b) => a + b, 0);
        const tgt = Object.keys(this.patternWeights).length;
        for (const k in this.patternWeights)
            this.patternWeights[k] = this.patternWeights[k] / total * tgt;
    }
    _prune() {
        if (this.moveScores.size > MAX_MOVE_MEMORY) {
            const entries = [...this.moveScores.entries()].sort((a, b) => a[1].count - b[1].count);
            for (const [k] of entries.slice(0, Math.floor(MAX_MOVE_MEMORY * 0.2)))
                this.moveScores.delete(k);
        }
        if (this.featureScores.size > MAX_MEMORY_SIZE) {
            const entries = [...this.featureScores.entries()].sort((a, b) => a[1].count - b[1].count);
            for (const [k] of entries.slice(0, Math.floor(MAX_MEMORY_SIZE * 0.2)))
                this.featureScores.delete(k);
        }
        if (this.blunderMoves.size > 2000) {
            const entries = [...this.blunderMoves.entries()].sort((a, b) => a[1] - b[1]);
            for (const [k] of entries.slice(0, 400))
                this.blunderMoves.delete(k);
        }
        if (this.drawPositions.size > 20000) {
            const entries = [...this.drawPositions.entries()].sort((a, b) => a[1] - b[1]);
            for (const [k] of entries.slice(0, 5000))
                this.drawPositions.delete(k);
        }
    }
    getStats() {
        return {
            gamesPlayed: this.gamesPlayed,
            winRate: this.gamesPlayed > 0 ? (this.gamesWon / this.gamesPlayed * 100).toFixed(1) : '0.0',
            moveMemory: this.moveScores.size,
            featureMemory: this.featureScores.size,
            blunders: this.blunderMoves.size,
            drawMemory: this.drawPositions.size,
            weights: { ...this.patternWeights },
        };
    }
    toJSON() {
        return {
            _version: 4,
            moveScores: [...this.moveScores.entries()],
            featureScores: [...this.featureScores.entries()],
            blunderMoves: [...this.blunderMoves.entries()],
            drawPositions: [...this.drawPositions.entries()],
            patternWeights: this.patternWeights,
            gamesPlayed: this.gamesPlayed,
            gamesWon: this.gamesWon,
        };
    }
    fromJSON(data) {
        if (data?.moveScores)
            this.moveScores = new Map(data.moveScores);
        if (data?.featureScores)
            this.featureScores = new Map(data.featureScores);
        if (data?.blunderMoves)
            this.blunderMoves = new Map(data.blunderMoves);
        if (data?.drawPositions)
            this.drawPositions = new Map(data.drawPositions);
        if (data?.patternWeights)
            this.patternWeights = { ...this.patternWeights, ...data.patternWeights };
        this.gamesPlayed = data?.gamesPlayed ?? 0;
        this.gamesWon = data?.gamesWon ?? data?.gamesWon ?? 0;
    }
}
export const adaptiveMemory = new AdaptiveMemory();
