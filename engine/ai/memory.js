import { SIDE, isPalaceSquare, onBank } from '../constants.js';

const LEARNING_RATE      = 0.12;
const MAX_MEMORY_SIZE    = 3000;
const MAX_MOVE_MEMORY    = 4000;
const BLUNDER_THRESHOLD  = 200;
const MISTAKE_THRESHOLD  = 80;
const DECAY_RATE         = 0.02;

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

  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (p.side === side) {
        if (p.type === 'archer' && onBank(side, r)) archerOnBank++;
        if (isPalaceSquare(r, c, enemy)) palacePressure++;
      }
    }
  }
  return `ap:${archerOnBank}|pp:${Math.min(palacePressure,3)}|r:${reserveCount}|er:${enemyReserveCount}|pt:${palaceTaken}|ept:${enemyPalaceTaken}|cu:${curseActive}|ecu:${enemyCurseActive}`;
}

export class AdaptiveMemory {
  constructor() {
    this.moveScores    = new Map();
    this.featureScores = new Map();
    this.blunderMoves  = new Map();
    this.drawPositions = new Map();
    this.maxDrawCount  = 5;
    this.patternWeights = {
      centerControl: 1.0, pieceActivity: 1.0, kingSafety: 1.0,
      materialBalance: 1.0, pawnStructure: 1.0, palacePressure: 1.0,
      position: 1.0, piecePlacement: 1.0, palaceDefence: 1.0, riverControl: 1.0
    };
    this.gamesPlayed = 0;
    this.gamesWon    = 0;
  }

  recordDrawGame(moves, drawStatus = 'draw') {
    if (!moves || moves.length === 0) return;
    const weight = drawStatus === 'draw_move_limit' ? 2 : 1;
    const seenHashes = new Set();
    for (const m of moves) {
      if (m.positionHash) {
        seenHashes.add(m.positionHash);
      }
    }
    for (const hash of seenHashes) {
      const count = (this.drawPositions.get(hash) || 0) + weight;
      if (count <= this.maxDrawCount) {
        this.drawPositions.set(hash, count);
      }
    }
    if (this.drawPositions.size > 20000) {
      const entries = [...this.drawPositions.entries()].sort((a,b) => a[1] - b[1]);
      const toDelete = entries.slice(0, 5000);
      for (const [h] of toDelete) this.drawPositions.delete(h);
    }
  }

  getDrawPenalty(hash) {
    if (!hash) return 0;
    const count = this.drawPositions.get(hash) || 0;
    if (count === 0) return 0;
    return Math.min(count * 70, 800);
  }

  recordGame(result, moves) {
    this.gamesPlayed++;
    if (result === 'win') this.gamesWon++;
    if (!moves || moves.length === 0) return;
    for (const [key, val] of this.moveScores) {
      val.total *= (1 - DECAY_RATE);
      val.count *= (1 - DECAY_RATE * 0.5);
    }
    for (const [key, val] of this.featureScores) {
      val.total *= (1 - DECAY_RATE);
      val.count *= (1 - DECAY_RATE * 0.5);
    }
    for (const [key, val] of this.blunderMoves) {
      this.blunderMoves.set(key, val * (1 - DECAY_RATE));
    }

    for (const m of moves) {
      if (!m) continue;
      const mk = m.moveKeyStr ?? m.positionKey ?? null;
      const fk = m.featureKey ?? null;
      const evalBefore = m.evalBefore ?? null;
      const evalAfter  = m.evalAfter  ?? null;

      if (mk !== null && evalBefore !== null && evalAfter !== null) {
        const side  = m.side ?? SIDE.BLACK;
        const sign  = side === SIDE.BLACK ? 1 : -1;
        const delta = (evalAfter - evalBefore) * sign;
        const prev  = this.moveScores.get(mk) ?? { total: 0, count: 0 };
        prev.total += delta;
        prev.count++;
        this.moveScores.set(mk, prev);

        if (delta <= -BLUNDER_THRESHOLD) {
          const pen = this.blunderMoves.get(mk) ?? 0;
          this.blunderMoves.set(mk, pen + Math.abs(delta));
        } else if (delta <= -MISTAKE_THRESHOLD) {
          const pen = this.blunderMoves.get(mk) ?? 0;
          this.blunderMoves.set(mk, pen + Math.abs(delta) * 0.4);
        }
      }
      if (fk !== null) {
        const delta = result === 'win' ? 1 : result === 'loss' ? -1 : 0;
        const prev  = this.featureScores.get(fk) ?? { total: 0, count: 0 };
        prev.total += delta;
        prev.count++;
        this.featureScores.set(fk, prev);
      }
    }
    this._adjustWeights(result, moves);
    this._prune();
  }

  getMovepenalty(mk) {
    if (!mk) return 0;
    const blunder = this.blunderMoves.get(mk) ?? 0;
    if (blunder > 0) return Math.min(blunder * 0.15, 120);
    const ms = this.moveScores.get(mk);
    if (!ms || ms.count < 2) return 0;
    const avg = ms.total / ms.count;
    if (avg < -50) return Math.min(Math.abs(avg) * 0.2, 80);
    return 0;
  }
  getFeatureScore(featureKey, phaseFactor) {
    if (!featureKey) return 0;
    const d = this.featureScores.get(featureKey);
    if (!d || d.count < 4) return 0;
    return (d.total / d.count) * 30 * (0.3 + phaseFactor * 0.7);
  }
  applyWeights(metrics) {
    return (
      (metrics.palacePressure  - 0.5) * this.patternWeights.palacePressure  * 30 +
      (metrics.kingSafety      - 0.5) * this.patternWeights.kingSafety      * 22 +
      (metrics.materialBalance - 0.5) * this.patternWeights.materialBalance * 12 +
      (metrics.pieceActivity   - 0.5) * this.patternWeights.pieceActivity   * 14 +
      (metrics.centerControl   - 0.5) * this.patternWeights.centerControl   * 10
    );
  }
  _adjustWeights(result, moves) {
    const factor = result === 'win' ? 1 + LEARNING_RATE : result === 'loss' ? 1 - LEARNING_RATE * 0.5 : 1;
    let cc=0,pa=0,ks=0,mb=0,pp=0,n=0;
    for (const m of moves) {
      if (!m?.metrics) continue;
      cc += m.metrics.centerControl   ?? 0;
      pa += m.metrics.pieceActivity   ?? 0;
      ks += m.metrics.kingSafety      ?? 0;
      mb += m.metrics.materialBalance ?? 0;
      pp += m.metrics.palacePressure  ?? 0;
      n++;
    }
    if (n === 0) return;
    const clamp = v => Math.min(2, Math.max(0.3, v));
    const adj   = avg => Math.abs(avg - 0.5) > 0.08;
    if (adj(cc/n)) this.patternWeights.centerControl   = clamp(this.patternWeights.centerControl   * factor);
    if (adj(pa/n)) this.patternWeights.pieceActivity   = clamp(this.patternWeights.pieceActivity   * factor);
    if (adj(ks/n)) this.patternWeights.kingSafety      = clamp(this.patternWeights.kingSafety      * factor);
    if (adj(mb/n)) this.patternWeights.materialBalance = clamp(this.patternWeights.materialBalance * factor);
    if (adj(pp/n)) this.patternWeights.palacePressure  = clamp(this.patternWeights.palacePressure  * factor);
    const total = Object.values(this.patternWeights).reduce((a,b) => a+b, 0);
    const tgt   = Object.keys(this.patternWeights).length;
    for (const k in this.patternWeights) this.patternWeights[k] = this.patternWeights[k] / total * tgt;
  }
  _prune() {
    if (this.moveScores.size > MAX_MOVE_MEMORY) {
      const entries = [...this.moveScores.entries()].sort((a,b) => a[1].count - b[1].count);
      for (const [k] of entries.slice(0, Math.floor(MAX_MOVE_MEMORY * 0.2))) this.moveScores.delete(k);
    }
    if (this.featureScores.size > MAX_MEMORY_SIZE) {
      const entries = [...this.featureScores.entries()].sort((a,b) => a[1].count - b[1].count);
      for (const [k] of entries.slice(0, Math.floor(MAX_MEMORY_SIZE * 0.2))) this.featureScores.delete(k);
    }
    if (this.blunderMoves.size > 2000) {
      const entries = [...this.blunderMoves.entries()].sort((a,b) => a[1] - b[1]);
      for (const [k] of entries.slice(0, 400)) this.blunderMoves.delete(k);
    }
    if (this.drawPositions.size > 20000) {
      const entries = [...this.drawPositions.entries()].sort((a,b) => a[1] - b[1]);
      for (const [k] of entries.slice(0, 5000)) this.drawPositions.delete(k);
    }
  }
  getStats() {
    return {
      gamesPlayed:   this.gamesPlayed,
      winRate:       this.gamesPlayed > 0 ? (this.gamesWon / this.gamesPlayed * 100).toFixed(1) : '0.0',
      moveMemory:    this.moveScores.size,
      featureMemory: this.featureScores.size,
      blunders:      this.blunderMoves.size,
      drawMemory:    this.drawPositions.size,
      weights:       { ...this.patternWeights },
    };
  }
  toJSON() {
    return {
      moveScores:     [...this.moveScores.entries()],
      featureScores:  [...this.featureScores.entries()],
      blunderMoves:   [...this.blunderMoves.entries()],
      drawPositions:  [...this.drawPositions.entries()],
      patternWeights: this.patternWeights,
      gamesPlayed:    this.gamesPlayed,
      gamesWon:       this.gamesWon,
    };
  }
  fromJSON(data) {
    if (data?.moveScores)     this.moveScores    = new Map(data.moveScores);
    if (data?.featureScores)  this.featureScores = new Map(data.featureScores);
    if (data?.blunderMoves)   this.blunderMoves  = new Map(data.blunderMoves);
    if (data?.drawPositions)  this.drawPositions = new Map(data.drawPositions);
    if (data?.patternWeights) this.patternWeights = { ...this.patternWeights, ...data.patternWeights };
    this.gamesPlayed = data?.gamesPlayed ?? 0;
    this.gamesWon    = data?.gamesWon    ?? 0;
  }
}

export const adaptiveMemory = new AdaptiveMemory();
