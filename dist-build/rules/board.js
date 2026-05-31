// ═════════════════════════════════════════════════════
//  Board Utilities (EN/ES)
// ES: Board Utilities (EN/ES)
//  Board creation, piece factory, position hashing, cloning
// ES: Board creation, piece factory, position hashing, cloning
// ═════════════════════════════════════════════════════
import { BOARD_SIZE, SIDE } from '../constants.js';
let _pieceIdCounter = 0;
// Factory: create a piece with unique ID
// ES: Crea una pieza con ID único
export function makePiece(type, side, promoted = false) {
    const id = `p_${Date.now()}_${++_pieceIdCounter}_${Math.random().toString(36).slice(2, 6)}`;
    return { id, type: type, side, promoted, locked: false };
}
export function mirrorRow(row) {
    return BOARD_SIZE - 1 - row;
}
// Initial board layout following traditional placement
// ES: Disposición inicial siguiendo la colocación tradicional
export function initialLayout() {
    const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    const topBack = ["tower", "cannon", "horse", "priest", "elephant", "general", "king", "queen", "elephant", "priest", "horse", "cannon", "tower"];
    const topMid = [null, "carriage", null, null, null, null, "archer", null, null, null, null, "carriage", null];
    const topPawn = Array(BOARD_SIZE).fill("pawn");
    for (let c = 0; c < BOARD_SIZE; c++) {
        board[0][c] = makePiece(topBack[c], SIDE.BLACK);
        if (topMid[c])
            board[1][c] = makePiece(topMid[c], SIDE.BLACK);
        board[2][c] = makePiece(topPawn[c], SIDE.BLACK);
    }
    const bottomBack = [...topBack].reverse();
    const bottomMid = [...topMid].reverse();
    const bottomPawn = Array(BOARD_SIZE).fill("pawn");
    for (let c = 0; c < BOARD_SIZE; c++) {
        board[12][c] = makePiece(bottomBack[c], SIDE.WHITE);
        if (bottomMid[c])
            board[11][c] = makePiece(bottomMid[c], SIDE.WHITE);
        board[10][c] = makePiece(bottomPawn[c], SIDE.WHITE);
    }
    return board;
}
export function insideOwnPalaceRow(side, row) {
    return side === SIDE.BLACK ? row >= 0 && row <= 2 : row >= 10 && row <= 12;
}
export function sameSide(piece, target) {
    return target !== null && piece !== null && target.side === piece.side;
}
// Ray-clear check: no pieces between two squares on a straight/diagonal line
// ES: Verifica si no hay piezas entre dos casillas en línea recta/diagonal
export function lineClear(board, r1, c1, r2, c2) {
    const dr = Math.sign(r2 - r1);
    const dc = Math.sign(c2 - c1);
    let r = r1 + dr;
    let c = c1 + dc;
    while (r !== r2 || c !== c2) {
        if (board[r][c])
            return false;
        r += dr;
        c += dc;
    }
    return true;
}
// Count pieces between two squares (used for cannon jump mechanics)
// ES: Cuenta piezas entre dos casillas (para mecánica de salto del cañón)
export function countBetween(board, r1, c1, r2, c2) {
    const dr = Math.sign(r2 - r1);
    const dc = Math.sign(c2 - c1);
    let r = r1 + dr;
    let c = c1 + dc;
    let count = 0;
    while (r !== r2 || c !== c2) {
        if (board[r][c])
            count++;
        r += dr;
        c += dc;
    }
    return count;
}
// Enumerate all squares between (r1,c1) and (r2,c2), exclusive
// ES: Enumera todas las casillas entre dos posiciones (excluyendo extremos)
export function pathSquares(r1, c1, r2, c2) {
    const out = [];
    const dr = Math.sign(r2 - r1);
    const dc = Math.sign(c2 - c1);
    let r = r1 + dr;
    let c = c1 + dc;
    while (r !== r2 || c !== c2) {
        out.push([r, c]);
        r += dr;
        c += dc;
    }
    return out;
}
export function pathIsClear(board, r1, c1, r2, c2) {
    const dr = Math.sign(r2 - r1);
    const dc = Math.sign(c2 - c1);
    let r = r1 + dr;
    let c = c1 + dc;
    while (r !== r2 || c !== c2) {
        if (board[r][c])
            return false;
        r += dr;
        c += dc;
    }
    return true;
}
// Find both kings on the board (returns { white: {r,c}, black: {r,c} })
// Exits as soon as both are found — no need to scan the full board.
// ES: Sale en cuanto encuentra ambos reyes — no escanea el tablero completo.
export function findKings(board) {
    const out = {};
    let found = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
        const row = board[r];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = row[c];
            if (p && p.type === 'king') {
                out[p.side] = { r, c, piece: p };
                if (++found === 2)
                    return out;
            }
        }
    }
    return out;
}
export function isEnemy(pieceA, pieceB) {
    return pieceA !== null && pieceB !== null && pieceA.side !== pieceB.side;
}
// ─── boardSignature optimizations ────────────────────────────────────────────
const _T = Object.create(null);
for (const [type, code] of Object.entries({
    king: 'ki',
    queen: 'qu',
    general: 'ge',
    elephant: 'el',
    priest: 'pr',
    horse: 'ho',
    cannon: 'ca',
    tower: 'to',
    carriage: 'cr',
    archer: 'ar',
    pawn: 'pw',
    crossbow: 'cb',
})) {
    _T[type] = {
        w: [code + 'w0', code + 'w1'],
        b: [code + 'b0', code + 'b1'],
    };
}
const _sigCells = new Array(BOARD_SIZE * BOARD_SIZE);
const _RES_TYPES = ['tower', 'general', 'pawn', 'crossbow'];
function _reserveKey(reserve) {
    if (!reserve.length)
        return '';
    let to = 0, ge = 0, pw = 0, cb = 0;
    for (let i = 0; i < reserve.length; i++) {
        const t = reserve[i].type;
        if (t === 'tower')
            to++;
        else if (t === 'general')
            ge++;
        else if (t === 'pawn')
            pw++;
        else if (t === 'crossbow')
            cb++;
    }
    let key = '';
    if (to)
        for (let i = 0; i < to; i++)
            key += (key ? ',' : '') + 'tower';
    if (ge)
        for (let i = 0; i < ge; i++)
            key += (key ? ',' : '') + 'general';
    if (pw)
        for (let i = 0; i < pw; i++)
            key += (key ? ',' : '') + 'pawn';
    if (cb)
        for (let i = 0; i < cb; i++)
            key += (key ? ',' : '') + 'crossbow';
    return key;
}
// Position signature string: compact board+turn+reserves encoding (for repetition detection)
// ES: Firma de posición: codificación compacta tablero+turno+reservas (para detección de repetición)
export function boardSignature(state) {
    const board = state.board;
    let i = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
        const row = board[r];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = row[c];
            _sigCells[i++] = p
                ? _T[p.type][p.side === SIDE.WHITE ? 'w' : 'b'][p.promoted ? 1 : 0]
                : '.';
        }
    }
    return _sigCells.join('')
        + '|t:' + state.turn
        + '|rw:' + _reserveKey(state.reserves.white)
        + '|rb:' + _reserveKey(state.reserves.black);
}
// Deep clone the entire game state (for search simulation)
// ES: Clon profundo del estado.
export function cloneState(state) {
    const board = new Array(BOARD_SIZE);
    for (let r = 0; r < BOARD_SIZE; r++) {
        const src = state.board[r];
        const dst = new Array(BOARD_SIZE);
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = src[c];
            dst[c] = p
                ? { id: p.id, type: p.type, side: p.side, promoted: p.promoted, locked: p.locked }
                : null;
        }
        board[r] = dst;
    }
    return {
        board,
        turn: state.turn,
        selected: null,
        legalMoves: [],
        reserves: {
            white: state.reserves.white.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id, locked: p.locked ?? false })),
            black: state.reserves.black.map(p => ({ type: p.type, side: p.side, promoted: p.promoted ?? false, id: p.id, locked: p.locked ?? false })),
        },
        promotionRequest: null,
        status: state.status,
        message: '',
        palaceTimers: {
            white: { ...(state.palaceTimers?.white ?? { pressure: 0, invaded: false, attackerSide: null }) },
            black: { ...(state.palaceTimers?.black ?? { pressure: 0, invaded: false, attackerSide: null }) },
        },
        palaceTaken: {
            white: state.palaceTaken?.white ?? false,
            black: state.palaceTaken?.black ?? false,
        },
        palaceCurse: state.palaceCurse ? {
            white: { active: state.palaceCurse.white.active, turnsInPalace: state.palaceCurse.white.turnsInPalace },
            black: { active: state.palaceCurse.black.active, turnsInPalace: state.palaceCurse.black.turnsInPalace },
        } : { white: { active: false, turnsInPalace: 0 }, black: { active: false, turnsInPalace: 0 } },
        lastMove: state.lastMove ? { ...state.lastMove } : null,
        lastRepeatedMoveKey: state.lastRepeatedMoveKey ?? null,
        repeatMoveCount: state.repeatMoveCount ?? 0,
        positionHistory: state.positionHistory instanceof Map
            ? new Map(state.positionHistory)
            : new Map(),
        history: state.history ? [...state.history] : [],
        archerAmbush: null,
        moveCount: state.moveCount ?? 0,
    };
}
