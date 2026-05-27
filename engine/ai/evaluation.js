import { dbg } from '../debug/debug.js';
import { SIDE, isPalaceSquare, opponent, onBank, isOwnSide, inBounds } from '../constants.js';
import { isKingInCheck } from '../rules/index.js';
import { adaptiveMemory, extractFeatures } from './memory.js';
import { pieceValue, pieceSquareBonus } from './piece-values.js';
import { buildAttackMap, DS_GENERAL, DS_HORSE, DS_CROSSBOW, PROM_TOWER_D, CANNON_D, ARCHER_D, CARRIAGE_D } from './attack-map.js';
export { buildAttackMap };

// ── Caché de predicción NN (solo raíz) ──
// ES: NN prediction cache (root only)
const nnCache = new Map();
let nnPredictFn = null; // set externally: (encoding) => Promise<score>

export const NN_CHANNELS = 24;
export const PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
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
      if (!p) continue;
      const ch = PIECE_CHANNEL[p.type];
      if (ch === undefined) continue;
      const offset = p.side === SIDE.WHITE ? 0 : 12;
      enc[(r * 13 + c) * NN_CHANNELS + offset + ch] = 1.0;
    }
  }
  return enc;
}

export function clampNNScore(nnScore) {
  if (typeof nnScore !== 'number' || Number.isNaN(nnScore) || !Number.isFinite(nnScore)) return null;
  return Math.max(-1, Math.min(1, nnScore));
}

export function blendScoreWithNN(classicalScore, nnScore, weight = 0.15, nnCpScale = 300) {
  const clamped = clampNNScore(nnScore);
  if (clamped === null) return classicalScore;
  const w = Math.max(0, Math.min(1, weight));
  const nnCp = clamped * nnCpScale;
  return classicalScore * (1 - w) + nnCp * w;
}

async function getNNScore(board, side) {
  if (!nnPredictFn) return null;
  // Build cache key from board state (compact fingerprint)
  let fprint = `${side}:`;
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) continue;
      fprint += `${p.type[0]}${p.side[0]}${p.promoted?1:0}`;
    }
  }
  if (nnCache.has(fprint)) {
    return nnCache.get(fprint);
  }

  const enc = encodeBoardForNN(board);
  const score = await nnPredictFn(enc);
  if (score !== null) nnCache.set(fprint, score);
  return score;
}

// ── NN scale factor: how much the NN contributes ──
// ES: Factor de escala NN: cuánto contribuye la NN
const NN_WEIGHT = 0.15;

function safeRatio(a, b, neutral = 0.5) {
  const total = a + b;
  return total === 0 ? neutral : a / total;
}

export function gamePhaseFactor(board) {
  let mat = 0;
  for (const row of board) for (const p of row) if (p && p.type !== 'pawn' && p.type !== 'king') mat += pieceValue(p);
  return Math.min(1.0, mat / 8000);
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

const HANGING_PENALTY_FACTOR  = 0.85; // increased from 0.42 — lose a piece = massive penalty
const DOUBLED_PAWN_PENALTY    = 22;
const PAWN_ADVANCE_WEIGHT     = 7;
const PALACE_PRESSURE_BONUS   = 350;
const MOBILITY_WEIGHT         = 9;
const TEMPO_BONUS             = 15;
const KING_ATTACK_PENALTY     = 400;
const KING_ESCAPE_PENALTY     = 200;
const KING_SHUFFLE_PENALTY    = 400;
const REPEAT_PENALTY          = 1200;

// ── Checkmate urgency & endgame acceleration ───────────────────────────────────
// ES: Urgencia de jaque mate y aceleración de final
// Scales with phaseFactor: strongest in middlegame/endgame when material is low
// and the bot should be looking for finishing blows, not quiet positioning.
// ES: Escala con phaseFactor: más fuerte en medio juego/final cuando hay poco
// material y el bot debería buscar golpes decisivos, no posicionamiento tranquilo.
const CHECKMATE_URGENCY_BASE   = 120;   // bonus for any attack on king zone
const CHECKMATE_URGENCY_PER    = 80;    // per attacker near the enemy king
const CHECKMATE_NEARNESS_BONUS = 60;    // bonus per enemy king escape square under attack
const CHECKMATE_DEPTH_BONUS    = 200;   // extra bonus when in endgame (phaseFactor < 0.3)

// ── Pawn chain & structure ──────────────────────────────────────────────────────
// ES: Cadena de peones y estructura
// Rewards pawn chains (pawns defending each other diagonally) which are the
// backbone of a strong positional structure. Avoids isolated and doubled pawns.
// ES: Recompensa cadenas de peones (peones que se defienden en diagonal) que son
// la columna vertebral de una estructura posicional fuerte.
const PAWN_CHAIN_BONUS         = 25;    // per pawn that defends another pawn
const PAWN_ISOLATED_PENALTY    = 30;    // per isolated pawn (no friendly pawns in adjacent columns)

// ── Jumping piece over-reliance penalty ───────────────────────────────────────
// ES: Penalización por exceso de dependencia de piezas que saltan
// Cannons, carriages, and generals that jump are powerful in the opening but
// the bot should also develop normal pieces. This slightly penalises making
// multiple consecutive jumps with the same piece type, encouraging variety.
const JUMP_REPEAT_PENALTY      = 50;    // per additional jump move by same piece type
const JUMP_EARLY_PENALTY       = 30;    // penalty per jump-piece moved before 3 non-jump pieces

// ── Development & Opening Urgency ──────────────────────────────────────────────
// ES: Desarrollo y urgencia de apertura
// Rewards piece activation in the opening and early midgame.
// The bot should feel increasing pressure to develop pieces and advance pawns
// the longer it stays in undeveloped starting positions.
// ES: Recompensa la activación de piezas en la apertura y medio juego temprano.
// El bot debe sentir presión creciente por desarrollar piezas y avanzar peones
// cuanto más tiempo permanezca en posiciones iniciales sin desarrollo.
const DEV_PIECE_MOVED_BONUS     = 45;   // per piece that has left its starting square
const DEV_PAWN_ADVANCED_BONUS   = 35;   // per pawn that has advanced at least 1 row
const DEV_UNDEVELOPED_PENALTY   = 60;   // per piece still on its home rank (back rank)
const DEV_MAX_OPENING_BONUS     = 300;  // max bonus when all pieces are active
const DEV_URGENCE_SCALE         = 0.6;  // how much urgency scales with game phase (0=never, 1=full)
const DEV_ACTIVATION_BONUS      = 30;   // bonus per piece that can move to enemy side of the river
const DEV_PIECE_IN_PLAY_BONUS   = 25;   // bonus per non-pawn non-king piece that's not on home rank

/**
 * Calculates development score for `side`.
 * Rewards pieces that have moved from their starting squares, pawns that have
 * advanced, and penalises undeveloped pieces still on home ranks.
 * Scales with phase factor: strongest in opening, fades in endgame.
 * ES: Calcula el score de desarrollo para `side`. Recompensa piezas que se han
 * movido de sus casillas iniciales, peones que han avanzado, y penaliza piezas
 * que siguen en sus filas iniciales. Escala con phaseFactor: más fuerte en
 * apertura, se desvanece en el final.
 */
function developmentScore(board, side, phaseFactor) {
  const openingUrgency = 1 - phaseFactor; // 1.0 in opening, ~0 in endgame
  const devWeight = Math.pow(openingUrgency, DEV_URGENCE_SCALE * 2 + 0.4);
  if (devWeight < 0.05) return 0; // skip if negligible

  const isBlack = side === SIDE.BLACK;
  const homeBackRank = isBlack ? 0 : 12;
  const homePawnRank = isBlack ? 2 : 10;
  const enemySideStart = isBlack ? 5 : 7; // first row on enemy side after river

  let movedPieces = 0;      // pieces that left their starting square
  let undeveloped = 0;      // pieces still on home back rank (non-pawn)
  let pawnsAdvanced = 0;    // pawns that advanced at least 1 row forward
  let pawnsOnHome = 0;      // pawns still on home pawn rank
  let piecesInEnemyTerritory = 0; // non-king pieces that crossed the river
  let piecesActive = 0;     // pieces in play (not on home back rank, non-king non-pawn)

  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p || p.side !== side) continue;
      if (p.type === 'king') continue; // exclude king

      if (p.type === 'pawn') {
        const advance = isBlack ? r - homePawnRank : homePawnRank - r;
        if (advance > 0) pawnsAdvanced++;
        else if (advance === 0) pawnsOnHome++;
        if (isBlack ? (r <= 5) : (r >= 7)) piecesInEnemyTerritory++;
      } else {
        // Non-king, non-pawn pieces
        if (r === homeBackRank) {
          undeveloped++; // still on starting back rank
        } else {
          movedPieces++;
          piecesActive++;
          if (isBlack ? (r <= 5) : (r >= 7)) piecesInEnemyTerritory++;
        }
      }
    }
  }

  // Score calculation
  let devScore = 
    movedPieces * DEV_PIECE_MOVED_BONUS
    + pawnsAdvanced * DEV_PAWN_ADVANCED_BONUS
    + piecesActive * DEV_ACTIVATION_BONUS / 2
    + piecesInEnemyTerritory * DEV_ACTIVATION_BONUS
    - undeveloped * DEV_UNDEVELOPED_PENALTY;

  // Cap max bonus
  devScore = Math.max(0, Math.min(DEV_MAX_OPENING_BONUS, devScore));

  // Scale by opening urgency
  return Math.round(devScore * devWeight);
}

// Palace defense: penalty for neglecting own palace
// ES: Defensa de palacio: penalización por descuidar el propio palacio
// PALACE_DEFENSE_BONUS  = total bonus distributed across own 9 palace squares covered
// ES: PALACE_DEFENSE_BONUS  = bono total repartido entre las 9 casillas del palacio propias cubiertas
// PALACE_UNDEFENDED_PEN = total penalty distributed across own palace squares attacked by enemy with no defense
// ES: PALACE_UNDEFENDED_PEN = penalización total repartida entre casillas del palacio propias que el enemigo ataca sin defensa
const PALACE_DEFENSE_BONUS    = 300;   // increased from 200
const PALACE_UNDEFENDED_PEN   = 500;   // increased from 300

// Palace curse & invasion danger weight adjustments
// ES: Ajustes de peso para maldición de palacio y peligro de invasión
const PALACE_CURSE_ACTIVE_PEN  = 400;   // base penalty when curse is active (was effectively 300)
const PALACE_CURSE_PER_INVADER = 120;   // extra penalty per enemy piece inside palace when curse active
const PALACE_PRE_CURSE_DANGER  = 60;    // per-turn danger before curse activates (turnsInPalace 1-2)
const PALACE_INVASION_PENALTY  = 200;   // penalty when enemy pieces are in your palace (regardless of curse)
const PALACE_RECKLESS_PENALTY  = 120;   // penalty for putting own piece in enemy palace (risks activating their curse)

// River control: bonus for controlling the river and for pieces that crossed
// ES: Control del río: bono por controlar el río y por piezas que ya cruzaron
// RIVER_CONTROL_BONUS  = total bonus per river column (row 6) that the side attacks
// ES: RIVER_CONTROL_BONUS  = bono total por columnas del río (fila 6) que el bando ataca
// CROSSED_RIVER_BONUS  = bonus per piece already in enemy territory (excludes king/archer with own bonuses)
// ES: CROSSED_RIVER_BONUS  = bono por pieza ya en territorio enemigo (excluye rey/arquero con bonos propios)
const RIVER_CONTROL_BONUS     = 80;
const CROSSED_RIVER_BONUS     = 120;

// Palace squares for each side
// ES: Casillas del palacio de cada bando
// Black: rows 0-2, cols 5-7  |  White: rows 10-12, cols 5-7
// ES: Negro: filas 0-2, cols 5-7  |  Blanco: filas 10-12, cols 5-7
const PALACE_ROWS_BLACK = [0, 1, 2];
const PALACE_ROWS_WHITE = [10, 11, 12];
const PALACE_COLS       = [5, 6, 7];
const RIVER_ROW         = 6;

/**
 * Counts enemy pieces inside `side`'s palace.
 * ES: Cuenta piezas enemigas dentro del palacio de `side`.
 */
function countPalaceInvaders(board, side) {
  const rows = side === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
  const enemy = opponent(side);
  let count = 0;
  for (const r of rows) {
    for (const c of PALACE_COLS) {
      const p = board[r][c];
      if (p && p.side === enemy) count++;
    }
  }
  return count;
}

/**
 * Counts own pieces inside the enemy's palace (reckless invaders that risk
 * activating the enemy's curse timer).
 * ES: Cuenta piezas propias dentro del palacio enemigo (invasores imprudentes
 * que arriesgan activar el timer de maldición enemigo).
 */
function countOurInvadersInEnemyPalace(board, side) {
  const enemy = opponent(side);
  const rows = enemy === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
  let count = 0;
  for (const r of rows) {
    for (const c of PALACE_COLS) {
      const p = board[r][c];
      if (p && p.side === side && p.type !== 'king') count++;
    }
  }
  return count;
}

/**
 * Calculates net palace defense score for `side`.
 * Returns positive if well defended, negative if neglected.
 * ES: Calcula el score neto de defensa del palacio propio para `side`.
 * Retorna positivo si bien defendido, negativo si descuidado.
 */
function palaceDefenseScore(ownAttackMap, enemyAttackMap, side) {
  const rows = side === SIDE.BLACK ? PALACE_ROWS_BLACK : PALACE_ROWS_WHITE;
  let defended = 0, undefended = 0;
  // OPT-9: Access Uint8Array directly via numeric index instead of squareKey string lookup.
  // Eliminates string allocation + .indexOf(',') + parseInt per cell on this hot path.
  // ES: Acceso directo a Uint8Array por índice numérico en lugar de squareKey string.
  const ownArr   = ownAttackMap._arr;
  const enemyArr = enemyAttackMap._arr;
  for (const r of rows) {
    for (const c of PALACE_COLS) {
      const i = r * 13 + c;
      const ownCoverage   = ownArr[i]   || 0;
      const enemyCoverage = enemyArr[i] || 0;
      if (ownCoverage > 0) defended++;
      if (enemyCoverage > 0 && ownCoverage === 0) undefended++;
    }
  }
  return defended   * (PALACE_DEFENSE_BONUS  / 9)
       - undefended * (PALACE_UNDEFENDED_PEN / 9);
}

/**
 * Calculates bonus for river control and pieces crossed to enemy territory.
 * ES: Calcula el bono por control del río y piezas ya cruzadas al territorio enemigo.
 */
function riverAndCrossedScore(board, side, ownAttackMap) {
  let riverCtrl = 0, crossedPieces = 0;
  // OPT-9: Direct Uint8Array access for river row — no string allocation per column.
  // ES: Acceso directo a Uint8Array para la fila del río.
  const riverArr = ownAttackMap._arr;
  const riverBase = RIVER_ROW * 13;
  for (let c = 0; c < 13; c++) {
    if (riverArr[riverBase + c]) riverCtrl++;
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
 * Weighted value of a side's reserve.
 * Tower and General have high urgency — heavy pieces the opponent can
 * drop and erase material advantages. Pawn has low urgency.
 * ES: Valor ponderado de la reserva de un bando.
 * Torre y General tienen urgencia alta — piezas pesadas que el oponente
 * puede soltar y borrar ventajas materiales. Peón tiene urgencia baja.
 */
function reserveValue(state, side) {
  return state.reserves[side].reduce((s, p) => {
    const urgency = p.type === 'tower'    ? 1.6
                  : p.type === 'general'  ? 1.6
                  : p.type === 'crossbow' ? 1.4
                  : 1.0; // pawn
    return s + pieceValue(p) * urgency;
  }, 0);
}

/**
 * Calculates the danger level from the palace curse system for `side`.
 * Returns a score adjustment (positive = good for side).
 * ES: Calcula el nivel de peligro del sistema de maldición de palacio para `side`.
 * Retorna un ajuste de score (positivo = bueno para el lado).
 */
function palaceDangerAdjustment(state, side) {
  const curse = state.palaceCurse?.[side];
  const board = state.board;
  let adjustment = 0;

  // Count invaders in our palace
  const invaderCount = countPalaceInvaders(board, side);

  if (invaderCount > 0) {
    // Base penalty for having enemy in your palace — signals danger
    // ES: Penalización base por tener enemigos en tu palacio — señal de peligro
    adjustment -= PALACE_INVASION_PENALTY;

    if (curse?.active) {
      // Curse active: enemy can capture anything inside. Severe penalty.
      // ES: Maldición activa: el enemigo puede capturar cualquier cosa dentro. Penalización severa.
      adjustment -= PALACE_CURSE_ACTIVE_PEN;
      adjustment -= invaderCount * PALACE_CURSE_PER_INVADER;
    } else if (curse) {
      // Pre-curse: danger escalates as turns pass (tick tock)
      // ES: Pre-maldición: el peligro escala con los turnos (tic tac)
      const turns = curse.turnsInPalace; // 1-2 typically
      adjustment -= turns * PALACE_PRE_CURSE_DANGER;
    }
  }

  return adjustment;
}

/**
 * Penalty for recklessly placing own pieces in the enemy palace.
 * This risks activating the enemy's curse timer, which gives them
 * the ability to capture freely inside their palace.
 * ES: Penalización por colocar imprudentemente piezas propias en el palacio enemigo.
 * Esto arriesga activar el timer de maldición del enemigo, dándoles la
 * capacidad de capturar libremente dentro de su palacio.
 */
function recklessInvasionPenalty(state, side) {
  const ourInvaders = countOurInvadersInEnemyPalace(state.board, side);
  const enemyCurse = state.palaceCurse?.[opponent(side)];
  if (ourInvaders === 0) return 0;

  let penalty = 0;
  if (enemyCurse?.active) {
    // Enemy curse active: our pieces in enemy palace can be captured for free!
    // ES: Maldición enemiga activa: ¡nuestras piezas en el palacio enemigo pueden ser capturadas gratis!
    penalty += ourInvaders * PALACE_CURSE_PER_INVADER * 2;
  } else if (enemyCurse && enemyCurse.turnsInPalace > 0) {
    // Enemy curse ticking: our pieces there are at risk of being trapped
    // ES: Maldición enemiga en cuenta regresiva: nuestras piezas allí corren riesgo
    penalty += ourInvaders * PALACE_RECKLESS_PENALTY;
  }
  return penalty;
}

// ── Checkmate Urgency ─────────────────────────────────────────────────────────
// ES: Urgencia de jaque mate
// Rewards the attacking side for putting pressure on the enemy king zone.
// Stronger in endgame when the bot should be looking for finishing blows.
function checkmateUrgencyScore(board, side, enemyKingPos, ownMap, enemyMap, phaseFactor) {
  if (!enemyKingPos) return 0;
  const enemy = opponent(side);
  const endgameUrgency = 1 - phaseFactor;

  let attackers = 0;
  let escapeSqUnderAttack = 0;

  // Count pieces attacking/adjacent to enemy king zone
  // ES: Contar piezas que atacan/están adyacentes a la zona del rey enemigo
  const kRow = enemyKingPos.r, kCol = enemyKingPos.c;
  const kingAdj = [[kRow-1,kCol-1],[kRow-1,kCol],[kRow-1,kCol+1],[kRow,kCol-1],[kRow,kCol+1],[kRow+1,kCol-1],[kRow+1,kCol],[kRow+1,kCol+1]];
  
  const ownArr = ownMap.attackMap._arr;
  const enemyArr = enemyMap.attackMap._arr;

  // Count our pieces attacking near the king (within 3 squares)
  for (let r = Math.max(0, kRow - 3); r <= Math.min(12, kRow + 3); r++) {
    for (let c = Math.max(0, kCol - 3); c <= Math.min(12, kCol + 3); c++) {
      if (ownArr[r * 13 + c]) {
        const p = board[r][c];
        if (p && p.side === side) attackers++;
      }
    }
  }

  // Count enemy king escape squares under attack
  for (const [er, ec] of kingAdj) {
    if (er >= 0 && er < 13 && ec >= 0 && ec < 13) {
      if (ownArr[er * 13 + ec]) escapeSqUnderAttack++;
    }
  }

  let urgency = attackers * CHECKMATE_URGENCY_PER + escapeSqUnderAttack * CHECKMATE_NEARNESS_BONUS;

  // Base urgency if any attacker is present
  if (attackers > 0) urgency += CHECKMATE_URGENCY_BASE;

  // Extra bonus in endgame (phaseFactor < 0.3 = more than 70% material gone)
  if (endgameUrgency > 0.7) urgency += CHECKMATE_DEPTH_BONUS;

  return Math.round(urgency * (0.5 + endgameUrgency * 0.5));
}

// ── Pawn Chain & Structure ──────────────────────────────────────────────────
// ES: Cadena de peones y estructura
// Rewards pawn chains (pawns defending each other diagonally).
// Penalises isolated pawns.
function pawnStructureScore(board, side) {
  const isBlack = side === SIDE.BLACK;
  const pawnPositions = [];

  // Collect all pawn positions for this side
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (p && p.side === side && p.type === 'pawn') {
        pawnPositions.push({ r, c });
      }
    }
  }

  if (pawnPositions.length < 2) return 0;

  let chainBonus = 0;
  let isolatedPenalty = 0;

  // Build column presence map for isolation detection
  const colPresence = new Set();
  for (const pos of pawnPositions) colPresence.add(pos.c);

  for (const pos of pawnPositions) {
    // Check if this pawn defends another pawn (chain)
    let isChain = false;
    for (const other of pawnPositions) {
      if (other.r === pos.r && other.c === pos.c) continue;
      // Pawn at (r,c) defends pawn at (r-1,c-1) or (r-1,c+1) if advancing
      // In this game, pawns move FORWARD: WHITE goes up (r decreases), BLACK goes down (r increases)
      const defendedR = isBlack ? pos.r + 1 : pos.r - 1;
      if (other.r === defendedR && (other.c === pos.c - 1 || other.c === pos.c + 1)) {
        isChain = true;
        break;
      }
    }
    if (isChain) chainBonus++;

    // Check if isolated (no friendly pawns in adjacent columns)
    let hasNeighbor = false;
    for (const adjCol of [pos.c - 1, pos.c + 1]) {
      if (colPresence.has(adjCol)) { hasNeighbor = true; break; }
    }
    if (!hasNeighbor) isolatedPenalty++;
  }

  return chainBonus * PAWN_CHAIN_BONUS - isolatedPenalty * PAWN_ISOLATED_PENALTY;
}

// ── Jumping piece over-reliance penalty ─────────────────────────────────────
// ES: Penalización por exceso de dependencia de piezas que saltan
// Penalises the bot for moving jumping pieces (cannon, carriage, general)
// before developing non-jumping pieces.
function jumpingPieceOverusePenalty(board, side, phaseFactor) {
  const isBlack = side === SIDE.BLACK;
  const homeBackRank = isBlack ? 0 : 12;
  const JUMP_TYPES = new Set(['cannon', 'carriage', 'general']);

  let jumpPiecesMoved = 0;
  let normalPiecesDeveloped = 0;
  let penalty = 0;

  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p || p.side !== side || p.type === 'king') continue;

      if (p.type === 'pawn') continue;

      if (JUMP_TYPES.has(p.type)) {
        // Jumping piece: count if it has moved off the back rank
        if (r !== homeBackRank) jumpPiecesMoved++;
      } else {
        // Normal piece: count if it has started developing
        if (r !== homeBackRank) normalPiecesDeveloped++;
      }
    }
  }

  // Penalty when jumping pieces are moved but few normal pieces are developed
  // Only applies in the opening (high phaseFactor)
  const openingUrgency = Math.max(0, 1 - phaseFactor);
  if (jumpPiecesMoved > 0 && normalPiecesDeveloped < 3) {
    const lack = 3 - normalPiecesDeveloped;
    penalty += lack * JUMP_EARLY_PENALTY;
  }

  // Extra penalty if more jump pieces moved than normal pieces developed
  if (jumpPiecesMoved > normalPiecesDeveloped && normalPiecesDeveloped > 0) {
    penalty += (jumpPiecesMoved - normalPiecesDeveloped) * JUMP_REPEAT_PENALTY;
  }

  return Math.round(penalty * openingUrgency);
}

// OPT-12: skipMemory=true omits extractFeatures()+getFeatureScore() in internal
// search nodes. Those build ~450 chars of strings per call — the real bottleneck.
// applyWeights() is NOT skipped: it is O(1) arithmetic (5 muls + 5 adds) and its
// contribution (up to ±88 pts with learned weights) is part of the eval function's
// core output. Skipping it would create a systematic gap of up to 88 pts between
// the root eval (which includes it) and every internal node eval (which wouldn't),
// causing the bot to misjudge lines that the adaptive weights care about.
//
// ES: skipMemory=true omite extractFeatures()+getFeatureScore() en nodos internos.
// Esas funciones construyen ~450 chars de strings por llamada — el verdadero cuello
// de botella. applyWeights() NO se omite: es aritmética O(1) y su aporte (hasta
// ±88 pts con pesos aprendidos) es parte core del eval. Omitirla crearía una
// inconsistencia sistemática de hasta 88 pts entre la raíz y los nodos internos.
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
      if (!piece) continue;
      const isBlack = piece.side === SIDE.BLACK;
      const ownMap = isBlack ? blackMap : whiteMap, enemyMap = isBlack ? whiteMap : blackMap;
      // OPT-9: Direct Uint8Array access — eliminates squareKey string alloc per cell.
      // ES: Acceso directo a Uint8Array — elimina string squareKey por celda.
      const _cellIdx = r * 13 + c;
      const attacks = enemyMap.attackMap._arr[_cellIdx] || 0;
      const mob = ownMap.byPiece._arr[_cellIdx] || 0;
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
      // Palace pressure from being in/attacking enemy palace
      // ES: Presión de palacio por estar/atacar el palacio enemigo
      if (isPalaceSquare(r,c,enemy)) {
        // Reduced pressure for being in enemy palace — it's risky and can trigger enemy curse
        // ES: Presión reducida por estar en palacio enemigo — es riesgoso y puede activar maldición enemiga
        if (isBlack) blackPalacePressure += 50;
        else         whitePalacePressure += 110;
      }
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
      // Archer on bank: bonus for blocked squares and protected troops
      // ES: Arquero en el banco: bono por casillas bloqueadas y tropas protegidas
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

  // OPT-9: Iterate over Uint8Array directly instead of the Map-wrapper iterator,
  // which emitted "r,c" strings and parsed them back — O(169) string allocs per call.
  // ES: Iterar el Uint8Array directamente, sin strings intermedios.
  { const arr = blackMap.attackMap._arr;
    for (let _i = 0; _i < 169; _i++) { if (!arr[_i]) continue;
      const r = (_i / 13) | 0, c = _i % 13, v = arr[_i];
      if (r>=4&&r<=8&&c>=4&&c<=8) blackCenterCtrl+=v;
      if (r>=10&&c>=5&&c<=7)      blackCenterCtrl+=v*5;
    }
  }
  { const arr = whiteMap.attackMap._arr;
    for (let _i = 0; _i < 169; _i++) { if (!arr[_i]) continue;
      const r = (_i / 13) | 0, c = _i % 13, v = arr[_i];
      if (r>=4&&r<=8&&c>=4&&c<=8) whiteCenterCtrl+=v;
      if (r<=2&&c>=5&&c<=7)       whiteCenterCtrl+=v*5;
    }
  }
  score += blackCenterCtrl - whiteCenterCtrl;

  // OPT-9: Same flat-array iteration for valuable piece attack counting.
  // ES: Iteración plana del array para conteo de piezas valiosas atacadas.
  let blackValuableAttacked = 0, whiteValuableAttacked = 0;
  { const arr = blackMap.attackMap._arr;
    for (let _i = 0; _i < 169; _i++) { if (!arr[_i]) continue;
      const r = (_i / 13) | 0, c = _i % 13;
      const target = board[r]?.[c];
      if (target && target.side !== SIDE.BLACK && pieceValue(target) > 300) blackValuableAttacked++;
    }
  }
  { const arr = whiteMap.attackMap._arr;
    for (let _i = 0; _i < 169; _i++) { if (!arr[_i]) continue;
      const r = (_i / 13) | 0, c = _i % 13;
      const target = board[r]?.[c];
      if (target && target.side !== SIDE.WHITE && pieceValue(target) > 300) whiteValuableAttacked++;
    }
  }
  score += Math.min(blackValuableAttacked * 8, 30);
  score -= Math.min(whiteValuableAttacked * 8, 30);

  // Reserves: weighted by type and relative threat
  // ES: Reservas: ponderadas por tipo y amenaza relativa
  // If the bot has material advantage, the enemy reserve is worth more as a threat
  // because the opponent can drop it and erase that advantage before it closes.
  // threatMultiplier scales from 1.0 (balanced) to 1.8 (advantage > 1600 pts).
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

  // ── Winning advantage conversion urgency ──
  // ES: Urgencia de conversión de ventaja
  // When ahead in material, the bot should push forward aggressively instead of
  // shuffling pieces. This adds an extra bonus proportional to material advantage
  // that incentivises the bot to cross the river, attack, and finish the game.
  // ES: Cuando tiene ventaja material, el bot debe avanzar agresivamente en lugar
  // de mover piezas sin rumbo. Esto añade un bono extra proporcional a la ventaja
  // que incentiva al bot a cruzar el río, atacar, y terminar la partida.
  const ADV_ADVANTAGE_THRESHOLD = 300;  // minimum material advantage to trigger urgency
  const ADV_CROSSED_RIVER_BONUS = 18;   // bonus per own piece in enemy territory when winning
  const ADV_PAWN_PUSH_BONUS     = 12;   // bonus per pawn advance when winning
  const ADV_MAX_URGENCY         = 400;  // max conversion urgency bonus
  let blackAdvUrgency = 0, whiteAdvUrgency = 0;
  if (materialAdv > ADV_ADVANTAGE_THRESHOLD) {
    // Black is winning — incentivise pushing forward
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const p = board[r][c];
        if (!p || p.side !== SIDE.BLACK) continue;
        if (p.type === 'king') continue;
        if (p.type !== 'pawn') {
          if (r <= 5) blackAdvUrgency += ADV_CROSSED_RIVER_BONUS;
        } else {
          const advance = 12 - r;
          blackAdvUrgency += advance * ADV_PAWN_PUSH_BONUS / 3;
        }
      }
    }
    blackAdvUrgency = Math.min(ADV_MAX_URGENCY, Math.round(blackAdvUrgency * (materialAdv / 2000)));
  }
  if (materialAdv < -ADV_ADVANTAGE_THRESHOLD) {
    // White is winning — incentivise pushing forward
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const p = board[r][c];
        if (!p || p.side !== SIDE.WHITE) continue;
        if (p.type === 'king') continue;
        if (p.type !== 'pawn') {
          if (r >= 7) whiteAdvUrgency += ADV_CROSSED_RIVER_BONUS;
        } else {
          const advance = r;
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

  // ── Palace curse & invasion danger ──
  // ES: Maldición de palacio y peligro de invasión
  // New comprehensive danger adjustments that properly penalize:
  // 1. Enemy pieces in own palace (pre-curse and active curse)
  // 2. Own pieces recklessly placed in enemy palace
  // 3. Replaces old simplistic palaceTaken/palaceCurse handling
  // ES: Nuevos ajustes de peligro que penalizan adecuadamente:
  // 1. Piezas enemigas en el palacio propio (pre-maldición y maldición activa)
  // 2. Piezas propias imprudentemente en el palacio enemigo
  // 3. Reemplaza el manejo simplista anterior de palaceTaken/palaceCurse
  const blackDanger = palaceDangerAdjustment(state, SIDE.BLACK);
  const whiteDanger = palaceDangerAdjustment(state, SIDE.WHITE);
  score += blackDanger - whiteDanger;

  // Reckless invasion penalty — don't put pieces in enemy palace if their curse is ticking
  // ES: Penalización por invasión imprudente — no poner piezas en palacio enemigo si su maldición está activa
  score -= recklessInvasionPenalty(state, SIDE.BLACK);
  score += recklessInvasionPenalty(state, SIDE.WHITE);

  // Keep palaceTaken bonus for winning condition, but reduce weight
  // ES: Mantener bono de palaceTaken por condición de victoria, pero reducir peso
  if (state.palaceTaken?.black) score += 350;
  if (state.palaceTaken?.white) score -= 350;

  const blackInvasion = countInminentPalaceInvasion(state, SIDE.BLACK, blackMap, whiteMap);
  const whiteInvasion = countInminentPalaceInvasion(state, SIDE.WHITE, whiteMap, blackMap);
  score += blackInvasion * 55;
  score -= whiteInvasion * 55;

  // Palace defense
  // ES: Defensa de palacio
  const blackPalaceDef = palaceDefenseScore(blackMap.attackMap, whiteMap.attackMap, SIDE.BLACK);
  const whitePalaceDef = palaceDefenseScore(whiteMap.attackMap, blackMap.attackMap, SIDE.WHITE);
  score += blackPalaceDef - whitePalaceDef;

  // River control
  // ES: Control del río
  const blackRiver = riverAndCrossedScore(board, SIDE.BLACK, blackMap.attackMap);
  const whiteRiver = riverAndCrossedScore(board, SIDE.WHITE, whiteMap.attackMap);
  score += blackRiver - whiteRiver;

  // ── Development & Opening Urgency ──
  // ES: Desarrollo y urgencia de apertura
  // Rewards piece activation in the opening. The bot is incentivised to move
  // pieces off their starting squares, advance pawns, and get pieces across the
  // river. This creates natural attacking pressure from the very first moves.
  // ES: Recompensa la activación de piezas en la apertura. El bot es incentivado
  // a mover piezas de sus casillas iniciales, avanzar peones, y cruzar el río.
  // Esto crea presión de ataque natural desde los primeros movimientos.
  const blackDev = developmentScore(board, SIDE.BLACK, phaseFactor);
  const whiteDev = developmentScore(board, SIDE.WHITE, phaseFactor);
  score += blackDev - whiteDev;

  // ── Checkmate urgency ──
  // ES: Urgencia de jaque mate
  // Rewards attacking pieces near the enemy king, especially in endgame.
  // ES: Recompensa piezas atacantes cerca del rey enemigo, especialmente en final.
  const blackMateUrgency = checkmateUrgencyScore(board, SIDE.BLACK, whiteMap.kingPos, blackMap, whiteMap, phaseFactor);
  const whiteMateUrgency = checkmateUrgencyScore(board, SIDE.WHITE, blackMap.kingPos, whiteMap, blackMap, phaseFactor);
  score += blackMateUrgency - whiteMateUrgency;

  // ── Pawn chain & structure ──
  // ES: Cadena de peones y estructura
  // Rewards pawn chains (pawns defending each other). Penalises isolated pawns.
  // ES: Recompensa cadenas de peones. Penaliza peones aislados.
  const blackPawnStruct = pawnStructureScore(board, SIDE.BLACK);
  const whitePawnStruct = pawnStructureScore(board, SIDE.WHITE);
  score += blackPawnStruct - whitePawnStruct;

  // ── Jumping piece over-reliance penalty ──
  // ES: Penalización por exceso de dependencia de piezas que saltan
  // Penalises over-using cannon/carriage/general without developing normal pieces.
  // ES: Penaliza el uso excesivo de cañón/carriage/general sin desarrollar piezas normales.
  score -= jumpingPieceOverusePenalty(board, SIDE.BLACK, phaseFactor);
  score += jumpingPieceOverusePenalty(board, SIDE.WHITE, phaseFactor);

  dbg.ai.group('eval:full', {
    blackDev:         blackDev,
    whiteDev:         whiteDev,
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
    palaceCurse:      `B:${state.palaceCurse?.black?.active ? `ACTIVE(${state.palaceCurse.black.turnsInPalace}t)` : state.palaceCurse?.black?.turnsInPalace > 0 ? `TICKING(${state.palaceCurse.black.turnsInPalace}t)` : 'off'} W:${state.palaceCurse?.white?.active ? `ACTIVE(${state.palaceCurse.white.turnsInPalace}t)` : state.palaceCurse?.white?.turnsInPalace > 0 ? `TICKING(${state.palaceCurse.white.turnsInPalace}t)` : 'off'}`,
    blackDanger:      blackDanger.toFixed(1),
    whiteDanger:      whiteDanger.toFixed(1),
  });

  score += state.turn === SIDE.BLACK ? TEMPO_BONUS : -TEMPO_BONUS;
  score += kingRecentMovePenalty(state);
  score -= repetitionPenalty(hash, Array.isArray(state.history) ? state.history : []);

  // ── OPT-12: Adaptive memory with proper granularity ──────────────────────────
  //
  // Bug in the naive skipMemory approach: skipping ALL of adaptiveMemory would
  // also skip applyWeights(), which contributes up to ±88 pts (with weights up
  // to 2.0 × 44 pts) and is O(1) arithmetic — no string allocation.
  // Only extractFeatures() + getFeatureScore() are expensive: they allocate
  // ~450 chars of strings and do Map lookups. Those are skipped in internal nodes.
  //
  // Split:
  //   ALWAYS: applyWeights(metrics)   — O(1), consistent eval across all nodes
  //   SKIP when skipMemory=true:
  //     extractFeatures()              — ~225 chars × 2 sides = ~450 chars allocated
  //     getFeatureScore()              — Map<string,…> lookup on that string
  //
  // ES: Bug del enfoque naive: omitir TODO adaptiveMemory también omite
  // applyWeights() (hasta ±88 pts, O(1) sin strings). Solo extractFeatures()
  // y getFeatureScore() son caros (strings + Map lookup). Esos se omiten en
  // nodos internos. applyWeights() SIEMPRE se aplica para consistencia del eval.
  // ─────────────────────────────────────────────────────────────────────────────

  // metrics is needed for applyWeights() regardless of skipMemory
  // ES: metrics se necesita para applyWeights() sin importar skipMemory
  const metrics = {
    palacePressure:  safeRatio(blackPalacePressure, whitePalacePressure),
    pieceActivity:   safeRatio(blackMap.mobilityCount.total, whiteMap.mobilityCount.total),
    materialBalance: safeRatio(blackMaterial, whiteMaterial),
    kingSafety:      safeRatio(blackKS + 500, whiteKS + 500),
    centerControl:   safeRatio(blackCenterCtrl, whiteCenterCtrl),
    palaceDefense:   safeRatio(blackPalaceDef + 100, whitePalaceDef + 100),
    riverControl:    safeRatio(blackRiver + 1, whiteRiver + 1),
  };

  // applyWeights: O(1) arithmetic — always run for eval consistency across all nodes
  // Even internal nodes (with precomputedMaps) must apply weights to avoid a systematic
  // gap between root eval and internal node eval (up to ±88 pts with learned weights).
  // ES: applyWeights: aritmética O(1) — siempre se ejecuta para consistencia.
  // Incluso nodos internos deben aplicar pesos para evitar brecha sistemática con la raíz.
  score += adaptiveMemory.applyWeights(metrics);

  // extractFeatures + getFeatureScore: expensive strings — skip in internal nodes
  // ES: extractFeatures + getFeatureScore: strings caros — omitir en nodos internos
  if (!skipMemory && !precomputedMaps) {
    const blackFk = extractFeatures(state, SIDE.BLACK);
    const whiteFk = extractFeatures(state, SIDE.WHITE);
    score += adaptiveMemory.getFeatureScore(blackFk, phaseFactor);
    score -= adaptiveMemory.getFeatureScore(whiteFk, phaseFactor);
  }
  dbg.perf.end(t);
  return { score, metrics };
}

/**
 * Counts how many of a side's pieces are attacking the enemy palace.
 * Flat Uint8Array iteration.
 * ES: countInminentPalaceInvasion usa iteración plana del Uint8Array.
 */
function countInminentPalaceInvasion(state, side, ownMap, enemyMap) {
  const enemy = opponent(side); let count = 0;
  const enemyKing = enemyMap.kingPos; if (!enemyKing) return 0;
  const arr = ownMap.attackMap._arr;
  for (let _i = 0; _i < 169; _i++) {
    if (!arr[_i]) continue;
    const r = (_i / 13) | 0, c = _i % 13;
    if (isPalaceSquare(r, c, enemy)) {
      const target = state.board[r]?.[c];
      if (!target || target.side !== side) count++;
    }
  }
  return count;
}

// OPT-9: kingSafetyFast uses direct Uint8Array index — no squareKey string.
// ES: kingSafetyFast usa índice directo en Uint8Array.
function kingSafetyFast(state, side, ownByPiece, enemyAttackMap, phaseFactor, kingPos) {
  if (!kingPos) return -5000;
  const _ki = kingPos.r * 13 + kingPos.c;
  const attacks = enemyAttackMap._arr[_ki] || 0;
  const escapes = ownByPiece._arr[_ki] || 0;
  let score = 120;
  score += isPalaceSquare(kingPos.r, kingPos.c, side) ? 25 : -65;
  if (state.palaceTaken?.[side]) score -= 90;
  score -= Math.min(3, attacks) * KING_ATTACK_PENALTY * phaseFactor;
  if (escapes < 3) score -= ((3-escapes)*KING_ESCAPE_PENALTY)*phaseFactor;
  score += kingShieldBonus(state.board, kingPos.r, kingPos.c, side) * phaseFactor;
  return score;
}

function repetitionPenalty(hash, history) {
  let seen = 0;
  for (const h of history) if (h === hash) seen++;
  return Math.max(0, seen - 1) * REPEAT_PENALTY;
}

function kingRecentMovePenalty(state) {
  const last = state.lastMove; if (!last?.from || !last?.to) return 0;
  const mp = state.board?.[last.to.r]?.[last.to.c]; if (!mp || mp.type !== 'king') return 0;
  let pen = KING_SHUFFLE_PENALTY * 0.35;
  if (isPalaceSquare(last.from.r,last.from.c,mp.side) && !isPalaceSquare(last.to.r,last.to.c,mp.side)) pen += 60;
  if (!isPalaceSquare(last.to.r,last.to.c,mp.side)) pen += 35;
  return mp.side === SIDE.BLACK ? -pen : pen;
}