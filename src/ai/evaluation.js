import { dbg } from '../debug.js';
import { SIDE, isPalaceSquare, opponent, onBank } from '../constants.js';
import { isKingInCheck } from '../rules/index.js';
import { adaptiveMemory, extractFeatures } from './memory.js';
import { pieceValue } from './moves.js';

function safeRatio(a, b, neutral = 0.5) {
  const total = a + b;
  return total === 0 ? neutral : a / total;
}

export function gamePhaseFactor(board) {
  let mat = 0;
  for (const row of board) for (const p of row) if (p && p.type !== 'pawn' && p.type !== 'king') mat += pieceValue(p);
  return Math.min(1.0, mat / 8000);
}

function centerBonus(r, c) { return (12 - Math.abs(r-6) - Math.abs(c-6)) * 3; }

function squareKey(r, c) { return `${r},${c}`; }

export function pieceSquareBonus(piece, r, c) {
  const prog = piece.side === SIDE.WHITE ? r : 12 - r;
  let bonus = centerBonus(r, c);
  switch (piece.type) {
    case 'pawn': bonus += prog * 12; if (piece.promoted) bonus += 22;
      if (piece.side === SIDE.WHITE && r >= 7) bonus += 14;
      if (piece.side === SIDE.BLACK && r <= 5) bonus += 14;
      break;
    case 'horse': bonus += (6 - Math.abs(r-6)) * 4; break;
    case 'cannon': bonus += prog * 4; break;
    case 'tower': bonus += prog * 4; break;
    case 'priest': bonus += 16; break;
    case 'archer': bonus += 16; if (onBank(piece.side, r)) bonus += 300; bonus += prog * 10; break;
    case 'king': bonus += isPalaceSquare(r, c, piece.side) ? 90 : -70; break;
    case 'queen': bonus += 35; break;
    case 'general': bonus += 18; break;
    case 'carriage': bonus += 10; break;
    case 'elephant': bonus += 8; break;
    case 'crossbow': bonus += 20; break;
  }
  return bonus;
}

function kingShieldBonus(board, kingR, kingC, side) {
  let shield = 0;
  const f = side === SIDE.WHITE ? 1 : -1;
  const dirs = [[f,-1],[f,0],[f,1],[0,-1],[0,1],[-f,-1],[-f,0],[-f,1]];
  for (const [dr,dc] of dirs) {
    const nr = kingR+dr, nc = kingC+dc;
    if (nr<0||nr>=13||nc<0||nc>=13) continue;
    const p = board[nr][nc];
    if (p && p.side === side && p.type !== 'king') { const weight = (dr === f) ? 1.5 : 1.0; shield += Math.min(pieceValue(p) * 0.08 * weight, 25); }
  }
  return shield;
}

const HANGING_PENALTY_FACTOR = 0.42;
const DOUBLED_PAWN_PENALTY    = 22;
const PAWN_ADVANCE_WEIGHT     = 7;
const PALACE_PRESSURE_BONUS   = 350;
const MOBILITY_WEIGHT         = 9;
const TEMPO_BONUS             = 15;
const KING_ATTACK_PENALTY     = 400;
const KING_ESCAPE_PENALTY     = 200;
const KING_SHUFFLE_PENALTY    = 400;
const REPEAT_PENALTY          = 1200;

// Palace defense: penalty for leaving own palace open / ES: penalización por descuidar palacio propio
const PALACE_DEFENSE_BONUS    = 200;
const PALACE_UNDEFENDED_PEN   = 300;

// River control: bonus for pieces near or across the river / ES: bono por control del río
const RIVER_CONTROL_BONUS     = 80;
const CROSSED_RIVER_BONUS     = 120;

export function evaluate(state, hash, precomputedMaps = null) {
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
      if (!piece) continue;
      const isBlack = piece.side === SIDE.BLACK;
      const ownMap = isBlack ? blackMap : whiteMap, enemyMap = isBlack ? whiteMap : blackMap;
      const attacks = enemyMap.attackMap.get(squareKey(r,c)) ?? 0;
      const mob = ownMap.byPiece.get(squareKey(r,c)) ?? 0;
      const val = pieceValue(piece);
      let local = val + pieceSquareBonus(piece, r, c);

      if (isBlack) blackMaterial += val; else whiteMaterial += val;

      if (attacks > 0) {
        let h = val * HANGING_PENALTY_FACTOR * attacks;
        if (attacks > 1) h += val * 0.12*(attacks-1);
        if (mob === 0)   h += val * 0.16;
        local -= Math.min(val*0.9, h);
      }
      if (mob === 0 && piece.type !== 'king') local -= 14;
      score += isBlack ? local : -local;

      const enemy = isBlack ? SIDE.WHITE : SIDE.BLACK;
      if (isPalaceSquare(r,c,enemy)) { if (isBlack) blackPalacePressure += 50; else whitePalacePressure += 110; }
      if (['tower','queen','cannon'].includes(piece.type)) {
        const palCenter = enemy===SIDE.BLACK ? 1 : 11;
        const dist = Math.abs(r-palCenter);
        if (dist<=4) { const pb=(5-Math.min(4,dist))*25; if (isBlack) blackPalacePressure+=pb; else whitePalacePressure+=pb; }
      }
      if (piece.type==='pawn') {
        const progress = isBlack ? (12 - r) : r;
        const pawnScore = progress*PAWN_ADVANCE_WEIGHT*(1+endgame);
        const crossed = isBlack ? (r <= 5) : (r >= 7);
        const ps = pawnScore+(crossed?12*(1+endgame):0)+(piece.promoted?24:0);
        score += isBlack ? ps : -ps;
        if (isBlack) blackPawnCols[c]++; else whitePawnCols[c]++;
      }
      if (piece.type === 'archer' && onBank(piece.side, r)) {
        const dir = piece.side === SIDE.WHITE ? 1 : -1;
        let blockedCount = 0, blocksPalace = false;
        for (const dc of [-1, 0, 1]) {
          const nr = r + dir, nc = c + dc;
          if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
            blockedCount++;
            if (isPalaceSquare(nr, nc, enemy)) blocksPalace = true;
          }
        }
        score += (piece.side === SIDE.BLACK ? 1 : -1) * blockedCount * 40;
        if (blocksPalace) score += (piece.side === SIDE.BLACK ? 1 : -1) * 120;
      }
    }
  }
  for (let c=0;c<13;c++) {
    if (blackPawnCols[c]>1) score -= (blackPawnCols[c]-1)*DOUBLED_PAWN_PENALTY;
    if (whitePawnCols[c]>1) score += (whitePawnCols[c]-1)*DOUBLED_PAWN_PENALTY;
  }
  score += blackPalacePressure - whitePalacePressure;

  for (const [k,v] of blackMap.attackMap) {
    const [r,c]=k.split(',').map(Number);
    if (r>=4&&r<=8&&c>=4&&c<=8) blackCenterCtrl+=v*1;
    if (r>=10&&c>=5&&c<=7)      blackCenterCtrl+=v*5;
  }
  for (const [k,v] of whiteMap.attackMap) {
    const [r,c]=k.split(',').map(Number);
    if (r>=4&&r<=8&&c>=4&&c<=8) whiteCenterCtrl+=v*1;
    if (r<=2&&c>=5&&c<=7)       whiteCenterCtrl+=v*5;
  }
  score += blackCenterCtrl - whiteCenterCtrl;

  let blackValuableAttacked = 0, whiteValuableAttacked = 0;
  for (const [k] of blackMap.attackMap) {
    const [r,c]=k.split(',').map(Number); const target = board[r]?.[c];
    if (target && target.side !== SIDE.BLACK && pieceValue(target) > 300) blackValuableAttacked++;
  }
  for (const [k] of whiteMap.attackMap) {
    const [r,c]=k.split(',').map(Number); const target = board[r]?.[c];
    if (target && target.side !== SIDE.WHITE && pieceValue(target) > 300) whiteValuableAttacked++;
  }
  score += Math.min(blackValuableAttacked * 8, 30);
  score -= Math.min(whiteValuableAttacked * 8, 30);

  score += reserveValue(state, SIDE.BLACK) - reserveValue(state, SIDE.WHITE);
  score += (state.reserves.black.length * 15) - (state.reserves.white.length * 15);
  score += (blackMap.mobilityCount.total - whiteMap.mobilityCount.total) * MOBILITY_WEIGHT;

  const blackKS = kingSafetyFast(state, SIDE.BLACK, blackMap.byPiece, whiteMap.attackMap, phaseFactor, blackMap.kingPos);
  const whiteKS = kingSafetyFast(state, SIDE.WHITE, whiteMap.byPiece, blackMap.attackMap, phaseFactor, whiteMap.kingPos);
  score += blackKS - whiteKS;

  if (state.palaceTaken?.black) score += 350;
  if (state.palaceTaken?.white) score -= 350;
  if (state.palaceCurse) {
    if (state.palaceCurse.black?.active) { score -= 300; score -= Math.min(state.palaceCurse.black.turnsInPalace - 3, 5) * 40; }
    if (state.palaceCurse.white?.active) { score += 300; score += Math.min(state.palaceCurse.white.turnsInPalace - 3, 5) * 40; }
  }

  const blackInvasion = countInminentPalaceInvasion(state, SIDE.BLACK, blackMap, whiteMap);
  const whiteInvasion = countInminentPalaceInvasion(state, SIDE.WHITE, whiteMap, blackMap);
  score += blackInvasion * 55;
  score -= whiteInvasion * 55;

  score += state.turn === SIDE.BLACK ? TEMPO_BONUS : -TEMPO_BONUS;
  score += kingRecentMovePenalty(state);
  score -= repetitionPenalty(hash, Array.isArray(state.history) ? state.history : []);

  const metrics = {
    palacePressure:  safeRatio(blackPalacePressure, whitePalacePressure),
    pieceActivity:   safeRatio(blackMap.mobilityCount.total, whiteMap.mobilityCount.total),
    materialBalance: safeRatio(blackMaterial, whiteMaterial),
    kingSafety:      safeRatio(blackKS + 500, whiteKS + 500),
    centerControl:   safeRatio(blackCenterCtrl, whiteCenterCtrl),
  };

  if (!precomputedMaps) {
    const blackFk = extractFeatures(state, SIDE.BLACK);
    const whiteFk = extractFeatures(state, SIDE.WHITE);
    score += adaptiveMemory.getFeatureScore(blackFk, phaseFactor);
    score -= adaptiveMemory.getFeatureScore(whiteFk, phaseFactor);
    score += adaptiveMemory.applyWeights(metrics);
  }
  dbg.perf.end(t);
  return { score, metrics };
}

export function buildAttackMap(board, side) {
  const attackMap = new Map(), mobilityCount = { total: 0 }, byPiece = new Map();
  let kingPos = null;
  const mark = (r, c, fromKey) => {
    if (r < 0 || r >= 13 || c < 0 || c >= 13) return;
    const k = `${r},${c}`; attackMap.set(k, (attackMap.get(k) ?? 0) + 1); mobilityCount.total++;
    byPiece.set(fromKey, (byPiece.get(fromKey) ?? 0) + 1);
  };
  const f = side === SIDE.WHITE ? 1 : -1;
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p || p.side !== side) continue;
      const fk = `${r},${c}`; if (p.type === 'king') kingPos = { r, c };
      const ray = (dr, dc) => { let nr = r+dr, nc = c+dc; while (nr>=0&&nr<13&&nc>=0&&nc<13) { mark(nr,nc,fk); if (board[nr][nc]) break; nr+=dr; nc+=dc; } };
      const jump = deltas => { for (const [dr,dc] of deltas) mark(r+dr, c+dc, fk); };
      switch (p.type) {
        case 'queen': ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); break;
        case 'tower':
        if (p.promoted) {
          const hdirs = [[0,1],[0,-1],[-1,1],[1,-1]];
          for (const [dr,dc] of hdirs) {
            let nr = r+dr, nc = c+dc;
            while (nr>=0 && nr<13 && nc>=0 && nc<13) {
              mark(nr,nc,fk);
              if (board[nr][nc]) break;
              nr+=dr; nc+=dc;
            }
          }
        } else {
          ray(1,0); ray(-1,0); ray(0,1); ray(0,-1);
        }
        break;
        case 'priest': ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); mark(r+f,c,fk); mark(r-f,c,fk); break;
        case 'cannon': {
          for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            let seen=0, nr=r+dr, nc=c+dc;
            while (nr>=0&&nr<13&&nc>=0&&nc<13) {
              if (!board[nr][nc]) { if (seen===0) mark(nr,nc,fk); }
              else { seen++; if (seen===2) { mark(nr,nc,fk); break; } }
              nr+=dr; nc+=dc;
            }
          } break;
        }
        case 'king': for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { if (dr===0&&dc===0) continue; for (let step=1;step<=2;step++) { const nr=r+dr*step, nc=c+dc*step; if (nr<0||nr>=13||nc<0||nc>=13) break; mark(nr,nc,fk); if (board[nr][nc]) break; } } break;
        case 'general': jump([[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]); for (let i=1;i<=4;i++) { mark(r+i,c+i,fk); mark(r+i,c-i,fk); mark(r-i,c+i,fk); mark(r-i,c-i,fk); } break;
        case 'horse': jump([[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]); break;
        case 'elephant': jump([[f,0],[f,-1],[f,1],[-f,-1],[-f,1]]); break;
        case 'pawn': mark(r+f,c,fk); mark(r+f,c-1,fk); mark(r+f,c+1,fk); mark(r,c-1,fk); mark(r,c+1,fk); break;
        case 'archer': jump([[3,1],[3,-1],[-3,1],[-3,-1],[1,3],[1,-3],[-1,3],[-1,-3]]); if (onBank(side,r)) { mark(r+f,c-1,fk); mark(r+f,c,fk); mark(r+f,c+1,fk); } break;
        case 'carriage': for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]) for (let step=1; step<=(Math.abs(dr)+Math.abs(dc)===1?4:1); step++) mark(r+dr*step, c+dc*step, fk); break;
        case 'crossbow': jump([[1,1],[1,-1],[-1,1],[-1,-1]]); mark(r+f,c,fk); break;
      }
    }
  }
  return { attackMap, mobilityCount, byPiece, kingPos };
}

function countInminentPalaceInvasion(state, side, ownMap, enemyMap) {
  const enemy = opponent(side); let count = 0;
  const enemyKing = enemyMap.kingPos; if (!enemyKing) return 0;
  for (const [key, val] of ownMap.attackMap) {
    const [r, c] = key.split(',').map(Number);
    if (isPalaceSquare(r, c, enemy) && val > 0) { const target = state.board[r]?.[c]; if (!target || target.side !== side) count++; }
  }
  return count;
}

function kingSafetyFast(state, side, ownByPiece, enemyAttackMap, phaseFactor, kingPos) {
  if (!kingPos) return -5000;
  const key = squareKey(kingPos.r, kingPos.c), attacks = enemyAttackMap.get(key) ?? 0, escapes = ownByPiece.get(key) ?? 0;
  let score = 120;
  score += isPalaceSquare(kingPos.r, kingPos.c, side) ? 25 : -65;
  if (state.palaceTaken?.[side]) score -= 90;
  score -= Math.min(3, attacks) * KING_ATTACK_PENALTY * phaseFactor;
  if (escapes < 3) score -= ((3-escapes)*KING_ESCAPE_PENALTY)*phaseFactor;
  score += kingShieldBonus(state.board, kingPos.r, kingPos.c, side) * phaseFactor;
  return score;
}

function repetitionPenalty(hash, history) { let seen = 0; for (const h of history) if (h === hash) seen++; return seen <= 0 ? 0 : seen * REPEAT_PENALTY; }

function reserveValue(state, side) { return state.reserves[side].reduce((s,p) => s + pieceValue(p), 0); }

function kingRecentMovePenalty(state) {
  const last = state.lastMove; if (!last?.from || !last?.to) return 0;
  const mp = state.board?.[last.to.r]?.[last.to.c]; if (!mp || mp.type !== 'king') return 0;
  let pen = KING_SHUFFLE_PENALTY * 0.35;
  if (isPalaceSquare(last.from.r,last.from.c,mp.side) && !isPalaceSquare(last.to.r,last.to.c,mp.side)) pen += 60;
  if (!isPalaceSquare(last.to.r,last.to.c,mp.side)) pen += 35;
  return mp.side === SIDE.BLACK ? -pen : pen;
}
