import { SIDE, isPalaceSquare, pieceLabel, pieceDisplayType } from "../../engine/constants.js";
import { COLS, state } from "../../engine/state.js";

function getPieceSymbol(type) {
  const symbols = { king:'K', queen:'Q', general:'G', elephant:'E', priest:'P', horse:'H', cannon:'C', tower:'T', carriage:'Ca', archer:'A', pawn:'p', crossbow:'B' };
  return symbols[type] || '?';
}

function generateMoveNotation(state, move, ambushInfo = null, chosenAmbushIndex = 0, capturedPiece = null) {
  if (!move) return '?';
  const toStr = `${COLS[move.to?.c ?? 0]}${13 - (move.to?.r ?? 0)}`;
  if (move.fromReserve) {
    const entry = state.reserves[state.turn]?.[move.reserveIndex];
    return `${getPieceSymbol(entry?.type ?? '?')}*${toStr}`;
  }
  if (!move.from) return '?';
  const piece = state.board[move.to.r]?.[move.to.c] ?? state.board[move.from.r]?.[move.from.c];
  if (!piece) return '?';
  const PROMO_SYMBOLS = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  const sym = piece.promoted ? (PROMO_SYMBOLS[piece.type] ?? getPieceSymbol(piece.type)) : getPieceSymbol(piece.type);
  if (piece.type === 'archer' && ambushInfo) {
    let nota = `A${toStr}`;
    if (ambushInfo.type === 'singleCapture') {
      const v = ambushInfo.victim;
      const vPiece = ambushInfo.victimPiece;
      const vSym = vPiece ? (vPiece.promoted ? (PROMO_SYMBOLS[vPiece.type] ?? getPieceSymbol(vPiece.type)) : getPieceSymbol(vPiece.type)) : '?';
      nota += `>${vSym}x${COLS[v.c]}${13 - v.r}`;
    } else if (ambushInfo.type === 'autoCaptureAll') {
      const parts = (ambushInfo.victimPieces ?? []).map((vp, i) => {
        const pos = ambushInfo.victims[i];
        const vsym = vp.promoted ? (PROMO_SYMBOLS[vp.type] ?? getPieceSymbol(vp.type)) : getPieceSymbol(vp.type);
        return `${vsym}x${COLS[pos.c]}${13 - pos.r}`;
      });
      if (parts.length) nota += `>${parts.join(',')}`;
    } else if (ambushInfo.type === 'chooseCapture') {
      const opts = ambushInfo.options;
      if (opts && opts.length > 0) {
        const chosen = opts[chosenAmbushIndex];
        const cSym = chosen.piece.promoted ? (PROMO_SYMBOLS[chosen.piece.type] ?? getPieceSymbol(chosen.piece.type)) : getPieceSymbol(chosen.piece.type);
        nota += `>${cSym}x${COLS[chosen.c]}${13 - chosen.r}`;
        for (let i = 0; i < opts.length; i++) {
          if (i === chosenAmbushIndex) continue;
          const opt = opts[i];
          const oSym = opt.piece.promoted ? (PROMO_SYMBOLS[opt.piece.type] ?? getPieceSymbol(opt.piece.type)) : getPieceSymbol(opt.piece.type);
          if (opt.canRetreat) {
            const retreatDir = piece.side === SIDE.BLACK ? 1 : -1;
            const rr = opt.r + retreatDir;
            nota += `,${oSym}${COLS[opt.c]}${13 - opt.r}→${COLS[opt.c]}${13 - rr}`;
          } else {
            nota += `,${oSym}x${COLS[opt.c]}${13 - opt.r}`;
          }
        }
      }
    }
    return nota;
  }
  const target = capturedPiece || state.board[move.to.r]?.[move.to.c];
  let notation = sym;
  if (target && target.side !== piece.side) {
    const targetSym = target.promoted ? (PROMO_SYMBOLS[target.type] ?? getPieceSymbol(target.type)) : getPieceSymbol(target.type);
    notation += `x${targetSym.toLowerCase()}${toStr}`;
  } else {
    notation += toStr;
  }
  if (move.promotion) notation += '+';
  return notation;
}

function appendCurseNotation(state) {
  const PROMO_SYMBOLS = { tower: 'U', horse: 'S', elephant: 'F', priest: 'W', cannon: 'R', pawn: 'B' };
  let suffix = '';
  for (const side of [SIDE.WHITE, SIDE.BLACK]) {
    const curse = state.palaceCurse?.[side];
    if (curse?.justActivated && curse.curseActivators) {
      const parts = [];
      for (const act of curse.curseActivators) {
        const sym = act.promoted ? (PROMO_SYMBOLS[act.type] ?? getPieceSymbol(act.type)) : getPieceSymbol(act.type);
        const loc = `${COLS[act.c]}${13 - act.r}`;
        parts.push(`${sym}${loc}`);
      }
      if (parts.length > 0) suffix += '&' + parts.join('&') + '-';
    }
  }
  return suffix || '';
}

function getPieceValue(piece) {
  const base  = { king:0, queen:950, general:560, elephant:240, priest:400, horse:320, cannon:450, tower:520, carriage:390, archer:450, pawn:110, crossbow:240 };
  const promo = { pawn:240, tower:650, horse:430, elephant:320, priest:540, cannon:540 };
  if (!piece) return 0;
  if (piece.promoted) return promo[piece.type] ?? (base[piece.type] ?? 0) + 120;
  return base[piece.type] ?? 0;
}

export { getPieceSymbol, generateMoveNotation, appendCurseNotation, getPieceValue };