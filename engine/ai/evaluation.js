import { dbg } from '../debug/debug.js';
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

const HANGING_PENALTY_FACTOR  = 0.42;
const DOUBLED_PAWN_PENALTY    = 22;
const PAWN_ADVANCE_WEIGHT     = 7;
const PALACE_PRESSURE_BONUS   = 350;
const MOBILITY_WEIGHT         = 9;
const TEMPO_BONUS             = 15;
const KING_ATTACK_PENALTY     = 400;
const KING_ESCAPE_PENALTY     = 200;
const KING_SHUFFLE_PENALTY    = 400;
const REPEAT_PENALTY          = 1200;

// Palace defense: penalización real por descuidar el propio palacio
// PALACE_DEFENSE_BONUS  = bono total repartido entre las 9 casillas del palacio propias cubiertas
// ES: PALACE_DEFENSE_BONUS  = bono total repartido entre las 9 casillas del palacio propias cubiertas
// PALACE_UNDEFENDED_PEN = penalización total repartida entre casillas del palacio propias que el enemigo ataca sin defensa
const PALACE_DEFENSE_BONUS    = 200;
const PALACE_UNDEFENDED_PEN   = 300;

// River control: bono por controlar el río y por piezas que ya cruzaron
// RIVER_CONTROL_BONUS  = bono total por columnas del río (fila 6) que el bando ataca
// CROSSED_RIVER_BONUS  = bono por pieza ya en territorio enemigo (excluye rey/arquero con bonos propios)
// ES: CROSSED_RIVER_BONUS  = bono por pieza ya en territorio enemigo (excluye rey/arquero con bonos propios)
const RIVER_CONTROL_BONUS     = 80;
const CROSSED_RIVER_BONUS     = 120;

// Casillas del palacio de cada bando
// ES: Casillas del palacio de cada bando
// Negro: filas 0-2, cols 5-7  |  Blanco: filas 10-12, cols 5-7
// ES: Negro: filas 0-2, cols 5-7  |  Blanco: filas 10-12, cols 5-7
const PALACE_ROWS_BLACK = [0, 1, 2];
const PALACE_ROWS_WHITE = [10, 11, 12];
const PALACE_COLS       = [5, 6, 7];
const RIVER_ROW         = 6;

/**
 * Calcula el score neto de defensa del palacio propio para `side`.
 * Retorna positivo si bien defendido, negativo si descuidado.
 */
function palaceDefenseScore(ownAttackMap, enemyAttackMap, side) {
  const rows = side === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
  let defended = 0, undefended = 0;
  for (const r of rows) {
    for (const c of PALACE_COLS) {
      const k = squareKey(r, c);
      const ownCoverage   = ownAttackMap.get(k)   ?? 0;
      const enemyCoverage = enemyAttackMap.get(k) ?? 0;
      if (ownCoverage > 0) defended++;
      if (enemyCoverage > 0 && ownCoverage === 0) undefended++;
    }
  }
  return defended   * (PALACE_DEFENSE_BONUS  / 9)
       - undefended * (PALACE_UNDEFENDED_PEN / 9);
}

/**
 * Calcula el bono por control del río y piezas ya cruzadas al territorio enemigo.
 */
function riverAndCrossedScore(board, side, ownAttackMap) {
  let riverCtrl = 0, crossedPieces = 0;
  for (let c = 0; c < 13; c++) {
    if ((ownAttackMap.get(squareKey(RIVER_ROW, c)) ?? 0) > 0) riverCtrl++;
  }
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p || p.side !== side) continue;
      if (p.type === 'king' || p.type === 'archer') continue;
      const crossed = side === SIDE.BLACK ? (r <= 5) : (r >= 7);
      if (crossed) crossedPieces++;
    }
  }
  return riverCtrl    * (RIVER_CONTROL_BONUS / 13)
       + crossedPieces * (CROSSED_RIVER_BONUS / 5);
}

/**
 * Valor ponderado de la reserva de un bando.
 * Torre y General tienen urgencia alta — piezas pesadas que el oponente
 * puede soltar y borrar ventajas materiales. Peón tiene urgencia baja.
 */
function reserveValue(state, side) {
  return state.reserves[side].reduce((s, p) => {
    const urgency = p.type === 'tower'    ? 1.6
                  : p.type === 'general'  ? 1.6
                  : p.type === 'crossbow' ? 1.2
                  : 1.0; // pawn
    return s + pieceValue(p) * urgency;
  }, 0);
}

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
      // ── Arquero en el banco: bono por casillas bloqueadas y tropas protegidas ──
      if (piece.type === 'archer' && onBank(piece.side, r)) {
        const dir = piece.side === SIDE.WHITE ? 1 : -1;
        let blockedCount = 0, blocksPalace = false;
        let shieldedAllies = 0, shieldedHighValue = 0;
        for (const dc of [-1, 0, 1]) {
          const nr = r + dir, nc = c + dc;
          if (nr >= 0 && nr < 13 && nc >= 0 && nc < 13) {
            blockedCount++;
            if (isPalaceSquare(nr, nc, enemy)) blocksPalace = true;
            // Premio por tropas propias desplegadas bajo la protección del arquero
            const sheltered = board[nr][nc];
            if (sheltered && sheltered.side === piece.side && sheltered.type !== 'king') {
              shieldedAllies++;
              if (pieceValue(sheltered) >= 450) shieldedHighValue++;
            }
          }
        }
        const sign = piece.side === SIDE.BLACK ? 1 : -1;
        score += sign * blockedCount * 40;
        if (blocksPalace) score += sign * 120;
        // +60 por aliado bajo protección, +50 adicional si es pieza pesada
        // Escala con phaseFactor: más valioso en mediojuego
        score += sign * shieldedAllies    * 60 * (0.5 + phaseFactor * 0.5);
        score += sign * shieldedHighValue * 50 * (0.5 + phaseFactor * 0.5);
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

  // ── Reservas: ponderadas por tipo y amenaza relativa ─────────────────────
  // Si el bot tiene ventaja material, la reserva enemiga vale más como amenaza
  // porque el oponente puede soltarla y borrar esa ventaja antes de que se cierre.
  // ES: porque el oponente puede soltarla y borrar esa ventaja antes de que se cierre.
  // threatMultiplier escala de 1.0 (equilibrio) hasta 1.8 (ventaja > 1600 pts).
  // ES: threatMultiplier escala de 1.0 (equilibrio) hasta 1.8 (ventaja > 1600 pts).
  const materialAdv = blackMaterial - whiteMaterial;
  const blackReserveVal = reserveValue(state, SIDE.BLACK);
  const whiteReserveVal = reserveValue(state, SIDE.WHITE);

  // Si negro va ganando, la reserva blanca es más peligrosa
  const whiteThreatMult = materialAdv > 150
    ? 1.0 + Math.min(materialAdv / 2000, 0.8)
    : 1.0;
  // Si blanco va ganando, la reserva negra es más peligrosa
  const blackThreatMult = materialAdv < -150
    ? 1.0 + Math.min(-materialAdv / 2000, 0.8)
    : 1.0;

  score += blackReserveVal * blackThreatMult - whiteReserveVal * whiteThreatMult;
  score += (state.reserves.black.length * 15 * blackThreatMult)
         - (state.reserves.white.length * 15 * whiteThreatMult);

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

  // ── Palace defense ────────────────────────────────────────────────────────
  const blackPalaceDef = palaceDefenseScore(blackMap.attackMap, whiteMap.attackMap, SIDE.BLACK);
  const whitePalaceDef = palaceDefenseScore(whiteMap.attackMap, blackMap.attackMap, SIDE.WHITE);
  score += blackPalaceDef - whitePalaceDef;

  // ── River control ─────────────────────────────────────────────────────────
  const blackRiver = riverAndCrossedScore(board, SIDE.BLACK, blackMap.attackMap);
  const whiteRiver = riverAndCrossedScore(board, SIDE.WHITE, whiteMap.attackMap);
  score += blackRiver - whiteRiver;

  dbg.ai.group('eval:full', {
    blackPalaceDef:   blackPalaceDef.toFixed(1),
    whitePalaceDef:   whitePalaceDef.toFixed(1),
    palaceNet:        (blackPalaceDef - whitePalaceDef).toFixed(1),
    blackRiver:       blackRiver.toFixed(1),
    whiteRiver:       whiteRiver.toFixed(1),
    riverNet:         (blackRiver - whiteRiver).toFixed(1),
    blackReserveVal:  blackReserveVal.toFixed(1),
    whiteReserveVal:  whiteReserveVal.toFixed(1),
    whiteThreatMult:  whiteThreatMult.toFixed(2),
    blackThreatMult:  blackThreatMult.toFixed(2),
    palaceTaken:      `B:${state.palaceTaken?.black ? 'YES' : 'no'} W:${state.palaceTaken?.white ? 'YES' : 'no'}`,
    palaceCurse:      `B:${state.palaceCurse?.black?.active ? `ACTIVE(${state.palaceCurse.black.turnsInPalace}t)` : 'off'} W:${state.palaceCurse?.white?.active ? `ACTIVE(${state.palaceCurse.white.turnsInPalace}t)` : 'off'}`,
  });

  score += state.turn === SIDE.BLACK ? TEMPO_BONUS : -TEMPO_BONUS;
  score += kingRecentMovePenalty(state);
  score -= repetitionPenalty(hash, Array.isArray(state.history) ? state.history : []);

  const metrics = {
    palacePressure:  safeRatio(blackPalacePressure, whitePalacePressure),
    pieceActivity:   safeRatio(blackMap.mobilityCount.total, whiteMap.mobilityCount.total),
    materialBalance: safeRatio(blackMaterial, whiteMaterial),
    kingSafety:      safeRatio(blackKS + 500, whiteKS + 500),
    centerControl:   safeRatio(blackCenterCtrl, whiteCenterCtrl),
    palaceDefense:   safeRatio(blackPalaceDef + 100, whitePalaceDef + 100),
    riverControl:    safeRatio(blackRiver + 1, whiteRiver + 1),
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
            for (const [dr,dc] of [[0,1],[0,-1],[-1,1],[1,-1]]) {
              let nr = r+dr, nc = c+dc;
              while (nr>=0&&nr<13&&nc>=0&&nc<13) { mark(nr,nc,fk); if (board[nr][nc]) break; nr+=dr; nc+=dc; }
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

function kingRecentMovePenalty(state) {
  const last = state.lastMove; if (!last?.from || !last?.to) return 0;
  const mp = state.board?.[last.to.r]?.[last.to.c]; if (!mp || mp.type !== 'king') return 0;
  let pen = KING_SHUFFLE_PENALTY * 0.35;
  if (isPalaceSquare(last.from.r,last.from.c,mp.side) && !isPalaceSquare(last.to.r,last.to.c,mp.side)) pen += 60;
  if (!isPalaceSquare(last.to.r,last.to.c,mp.side)) pen += 35;
  return mp.side === SIDE.BLACK ? -pen : pen;
}