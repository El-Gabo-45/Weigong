// Incremental Attack Map - TypeScript
import { SIDE, isOwnSide, onBank, inBounds } from '../constants.ts';
const BOARD_SIZE = 13;
const NUM_CELLS = BOARD_SIZE * BOARD_SIZE;
const MAP_POOL_SIZE = 4096;
let mapPoolIdx = 0;
const mapPool = [];
for (let i = 0; i < MAP_POOL_SIZE; i++) {
    mapPool.push({
        attack: new Uint8Array(NUM_CELLS),
        byPiece: new Uint8Array(NUM_CELLS),
        mobCount: 0,
        kingIdx: -1,
        enemyKingIdx: -1,
    });
}
function acquireMap() {
    const m = mapPool[mapPoolIdx];
    mapPoolIdx = (mapPoolIdx + 1) % MAP_POOL_SIZE;
    m.attack.fill(0);
    m.byPiece.fill(0);
    m.mobCount = 0;
    m.kingIdx = -1;
    m.enemyKingIdx = -1;
    return m;
}
function idx(r, c) { return r * 13 + c; }
const DS_GENERAL = [2, 1, 2, -1, -2, 1, -2, -1, 1, 2, 1, -2, -1, 2, -1, -2];
const DS_CROSSBOW = [1, 1, 1, -1, -1, 1, -1, -1];
const PROM_TOWER_D = [0, 1, 0, -1, -1, 1, 1, -1];
const CANNON_D = [1, 0, -1, 0, 0, 1, 0, -1];
const ARCHER_D = [3, 1, 3, -1, -3, 1, -3, -1, 1, 3, 1, -3, -1, 3, -1, -3];
const CARRIAGE_D = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
export class IncrementalAttackMap {
    _map = null;
    _side = null;
    _board = null;
    init(board, side) {
        this._side = side;
        this._board = board;
        this._map = this._buildFull(board, side);
        return this._map;
    }
    get() {
        return this._map;
    }
    applyMove(state, move, capturedPiece, movedPiece, shouldPromote) {
        const pm = this._map?.attackMap?._raw;
        if (!pm) {
            this.rebuild(state.board);
            return;
        }
        const attackArr = pm.attack;
        const byPiece = pm.byPiece;
        attackArr.fill(0);
        byPiece.fill(0);
        pm.mobCount = 0;
        pm.kingIdx = -1;
        pm.enemyKingIdx = -1;
        const board = state.board;
        const side = this._side;
        const f = side === SIDE.WHITE ? 1 : -1;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = board[r][c];
                if (!p)
                    continue;
                if (p.side === side) {
                    const fi = idx(r, c);
                    if (p.type === 'king')
                        pm.kingIdx = fi;
                    this._generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm);
                }
                else if (p.type === 'king') {
                    pm.enemyKingIdx = idx(r, c);
                }
            }
        }
        this._kingLineAttack(board, side, pm, attackArr, byPiece);
        pm.mobCount = this._countMobility(byPiece);
        this._board = board;
    }
    unmakeMove(state) {
        this._board = state.board;
        this._map = this._buildFull(state.board, this._side);
    }
    rebuild(board) {
        const pm = this._map?.attackMap?._raw;
        if (pm) {
            const attackArr = pm.attack;
            const byPiece = pm.byPiece;
            attackArr.fill(0);
            byPiece.fill(0);
            pm.mobCount = 0;
            pm.kingIdx = -1;
            pm.enemyKingIdx = -1;
            const side = this._side;
            const f = side === SIDE.WHITE ? 1 : -1;
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = board[r][c];
                    if (!p)
                        continue;
                    if (p.side === side) {
                        const fi = idx(r, c);
                        if (p.type === 'king')
                            pm.kingIdx = fi;
                        this._generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm);
                    }
                    else if (p.type === 'king') {
                        pm.enemyKingIdx = idx(r, c);
                    }
                }
            }
            this._kingLineAttack(board, side, pm, attackArr, byPiece);
            pm.mobCount = this._countMobility(byPiece);
            this._board = board;
        }
        else {
            this._board = board;
            this._map = this._buildFull(board, this._side);
        }
    }
    _buildFull(board, side) {
        const pm = acquireMap();
        const attackArr = pm.attack, byPiece = pm.byPiece;
        const f = side === SIDE.WHITE ? 1 : -1;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = board[r][c];
                if (!p)
                    continue;
                if (p.side === side) {
                    const fi = idx(r, c);
                    if (p.type === 'king')
                        pm.kingIdx = fi;
                    this._generateMoves(board, r, c, p, f, fi, attackArr, byPiece, pm);
                }
                else if (p.type === 'king') {
                    pm.enemyKingIdx = idx(r, c);
                }
            }
        }
        this._kingLineAttack(board, side, pm, attackArr, byPiece);
        pm.mobCount = this._countMobility(byPiece);
        return this._wrapResult(pm, attackArr, byPiece);
    }
    _generateMoves(board, r, c, p, f, fi, attackArr, byPiece, _pm) {
        const mark = (nr, nc) => {
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE)
                return;
            const i = idx(nr, nc);
            if (attackArr[i] < 255)
                attackArr[i]++;
            byPiece[fi]++;
        };
        switch (p.type) {
            case 'queen':
                this._ray(board, r, c, 1, 0, mark);
                this._ray(board, r, c, -1, 0, mark);
                this._ray(board, r, c, 0, 1, mark);
                this._ray(board, r, c, 0, -1, mark);
                this._ray(board, r, c, 1, 1, mark);
                this._ray(board, r, c, 1, -1, mark);
                this._ray(board, r, c, -1, 1, mark);
                this._ray(board, r, c, -1, -1, mark);
                break;
            case 'tower':
                if (p.promoted) {
                    this._ray(board, r, c, 0, 1, mark);
                    this._ray(board, r, c, 0, -1, mark);
                    this._ray(board, r, c, -1, 1, mark);
                    this._ray(board, r, c, 1, -1, mark);
                }
                else {
                    this._ray(board, r, c, 1, 0, mark);
                    this._ray(board, r, c, -1, 0, mark);
                    this._ray(board, r, c, 0, 1, mark);
                    this._ray(board, r, c, 0, -1, mark);
                }
                break;
            case 'priest':
                this._ray(board, r, c, 1, 1, mark);
                this._ray(board, r, c, 1, -1, mark);
                this._ray(board, r, c, -1, 1, mark);
                this._ray(board, r, c, -1, -1, mark);
                mark(r + f, c);
                mark(r - f, c);
                break;
            case 'cannon':
                for (let d = 0; d < 8; d += 2) {
                    const dr = CANNON_D[d], dc = CANNON_D[d + 1];
                    let seen = 0, nr = r + dr, nc = c + dc;
                    while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        if (!board[nr][nc]) {
                            if (seen === 0)
                                mark(nr, nc);
                        }
                        else {
                            seen++;
                            if (seen === 2) {
                                mark(nr, nc);
                                break;
                            }
                        }
                        nr += dr;
                        nc += dc;
                    }
                }
                break;
            case 'king':
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0)
                            continue;
                        for (let step = 1; step <= 2; step++) {
                            const nr = r + dr * step, nc = c + dc * step;
                            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE)
                                break;
                            mark(nr, nc);
                            if (board[nr][nc])
                                break;
                        }
                    }
                }
                break;
            case 'general':
                this._jump(DS_GENERAL, r, c, mark);
                for (let i = 1; i <= 4; i++) {
                    mark(r + i, c + i);
                    mark(r + i, c - i);
                    mark(r - i, c + i);
                    mark(r - i, c - i);
                }
                break;
            case 'horse':
                this._jump(DS_GENERAL, r, c, mark);
                break;
            case 'elephant':
                mark(r + f, c);
                mark(r + f, c - 1);
                mark(r + f, c + 1);
                mark(r - f, c - 1);
                mark(r - f, c + 1);
                break;
            case 'pawn':
                mark(r + f, c);
                mark(r + f, c - 1);
                mark(r + f, c + 1);
                mark(r, c - 1);
                mark(r, c + 1);
                break;
            case 'archer':
                for (let d = 0; d < 16; d += 2) {
                    const nr = r + ARCHER_D[d], nc = c + ARCHER_D[d + 1];
                    if (!inBounds(nr, nc))
                        continue;
                    if (!isOwnSide(side, nr))
                        continue;
                    mark(nr, nc);
                }
                if (onBank(side, r)) {
                    mark(r + f, c - 1);
                    mark(r + f, c);
                    mark(r + f, c + 1);
                    mark(r + 2 * f, c - 1);
                    mark(r + 2 * f, c);
                    mark(r + 2 * f, c + 1);
                }
                break;
            case 'carriage':
                for (let d = 0; d < 16; d += 2) {
                    const dr = CARRIAGE_D[d], dc = CARRIAGE_D[d + 1];
                    const maxStep = (Math.abs(dr) + Math.abs(dc) === 1) ? 4 : 1;
                    let nr = r + dr, nc = c + dc;
                    for (let step = 1; step <= maxStep; step++) {
                        if (!inBounds(nr, nc))
                            break;
                        if (!isOwnSide(side, nr))
                            break;
                        mark(nr, nc);
                        if (board[nr][nc])
                            break;
                        nr += dr;
                        nc += dc;
                    }
                }
                break;
            case 'crossbow':
                this._jump(DS_CROSSBOW, r, c, mark);
                mark(r + f, c);
                break;
        }
    }
    _ray(board, r, c, dr, dc, mark) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
            mark(nr, nc);
            if (board[nr][nc])
                break;
            nr += dr;
            nc += dc;
        }
    }
    _jump(deltas, r, c, mark) {
        for (let d = 0; d < deltas.length; d += 2)
            mark(r + deltas[d], c + deltas[d + 1]);
    }
    _kingLineAttack(board, side, pm, attackArr, byPiece) {
        if (pm.kingIdx < 0 || pm.enemyKingIdx < 0)
            return;
        const kr = Math.floor(pm.kingIdx / 13), kc = pm.kingIdx % 13;
        const er = Math.floor(pm.enemyKingIdx / 13), ec = pm.enemyKingIdx % 13;
        const dr = Math.sign(er - kr);
        const dc = Math.sign(ec - kc);
        if (dr === 0 && dc === 0)
            return;
        const sameRow = dr === 0, sameCol = dc === 0;
        const sameDiag = !sameRow && !sameCol && Math.abs(er - kr) === Math.abs(ec - kc);
        if (!sameRow && !sameCol && !sameDiag)
            return;
        let clear = true;
        let cr = kr + dr, cc = kc + dc;
        while (cr !== er || cc !== ec) {
            if (board[cr][cc]) {
                clear = false;
                break;
            }
            cr += dr;
            cc += dc;
        }
        if (clear) {
            const i = idx(er, ec);
            if (attackArr[i] < 255)
                attackArr[i]++;
            byPiece[pm.kingIdx]++;
        }
    }
    _countMobility(byPiece) {
        let count = 0;
        for (let i = 0; i < NUM_CELLS; i++) {
            if (byPiece[i] > 0)
                count++;
        }
        return count;
    }
    _wrapResult(pm, attackArr, byPiece) {
        const attackMap = {
            _arr: attackArr,
            _raw: pm,
            get(k) {
                const comma = k.indexOf(',');
                const r = +k.slice(0, comma), c = +k.slice(comma + 1);
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE)
                    return 0;
                return this._arr[r * 13 + c] || 0;
            },
            [Symbol.iterator]() {
                const arr = this._arr;
                let i = -1;
                return {
                    next() {
                        i++;
                        while (i < NUM_CELLS && !arr[i])
                            i++;
                        if (i >= NUM_CELLS)
                            return { done: true, value: undefined };
                        const r = Math.floor(i / 13), c = i % 13;
                        return { done: false, value: [`${r},${c}`, arr[i]] };
                    }
                };
            },
        };
        const byPieceWrapper = {
            _arr: byPiece,
            get(k) {
                const comma = k.indexOf(',');
                const r = +k.slice(0, comma), c = +k.slice(comma + 1);
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE)
                    return 0;
                return this._arr[r * 13 + c] || 0;
            },
            [Symbol.iterator]() {
                const arr = this._arr;
                let i = -1;
                return {
                    next() {
                        i++;
                        while (i < NUM_CELLS && !arr[i])
                            i++;
                        if (i >= NUM_CELLS)
                            return { done: true, value: undefined };
                        const r = Math.floor(i / 13), c = i % 13;
                        return { done: false, value: [`${r},${c}`, arr[i]] };
                    }
                };
            },
        };
        const kingPos = pm.kingIdx >= 0 ? { r: Math.floor(pm.kingIdx / 13), c: pm.kingIdx % 13 } : null;
        return {
            attackMap,
            byPiece: byPieceWrapper,
            mobilityCount: { total: pm.mobCount },
            kingPos,
        };
    }
}
export function createIncrementalMaps(board) {
    const blackMap = new IncrementalAttackMap();
    const whiteMap = new IncrementalAttackMap();
    const result = {
        black: blackMap.init(board, SIDE.BLACK),
        white: whiteMap.init(board, SIDE.WHITE),
        _blackInc: blackMap,
        _whiteInc: whiteMap,
    };
    return result;
}
export function applyMoveToMaps(maps, state, move, capturedPiece, movedPiece, shouldPromote) {
    if (maps._blackInc)
        maps._blackInc.applyMove(state, move, capturedPiece, movedPiece, shouldPromote);
    if (maps._whiteInc)
        maps._whiteInc.applyMove(state, move, capturedPiece, movedPiece, shouldPromote);
    return maps;
}
export function rebuildMaps(board) {
    return createIncrementalMaps(board);
}
