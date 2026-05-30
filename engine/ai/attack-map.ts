// Attack Map Builder - TypeScript
import { SIDE, opponent, onBank, isOwnSide, inBounds, isPalaceSquare } from '../constants.js';
import type { Board, Side, Piece, AttackMaps, AttackMapRaw } from '../types.js';

const MAP_POOL_SIZE = 2048;
let mapPoolIdx = 0;
const mapPool: AttackMapRaw[] = [];

for (let i = 0; i < MAP_POOL_SIZE; i++) {
  mapPool.push({
    attack: new Uint8Array(169),
    byPiece: new Uint8Array(169),
    mobCount: 0,
    kingIdx: -1,
    enemyKingIdx: -1,
  });
}

function acquireMap(): AttackMapRaw {
  const m = mapPool[mapPoolIdx];
  mapPoolIdx = (mapPoolIdx + 1) % MAP_POOL_SIZE;
  m.attack.fill(0);
  m.byPiece.fill(0);
  m.mobCount = 0;
  m.kingIdx = -1;
  m.enemyKingIdx = -1;
  return m;
}

export const DS_GENERAL = [2,1, 2,-1, -2,1, -2,-1, 1,2, 1,-2, -1,2, -1,-2];
export const DS_HORSE = DS_GENERAL;
export const DS_CROSSBOW = [1,1, 1,-1, -1,1, -1,-1];
export const PROM_TOWER_D = [0,1, 0,-1, -1,1, 1,-1];
export const CANNON_D = [1,0, -1,0, 0,1, 0,-1];
export const ARCHER_D = [3,1, 3,-1, -3,1, -3,-1, 1,3, 1,-3, -1,3, -1,-3];
export const CARRIAGE_D = [1,0, -1,0, 0,1, 0,-1, 1,1, 1,-1, -1,1, -1,-1];

export function buildAttackMap(board: Board, side: Side): AttackMaps {
  const pm = acquireMap();
  const attackArr = pm.attack, byPiece = pm.byPiece;
  let mobCount = 0, kingIdx = -1, enemyKingIdx = -1;
  const mark = (r: number, c: number, fi: number): void => {
    if (r < 0 || r >= 13 || c < 0 || c >= 13) return;
    const i = r * 13 + c;
    if (attackArr[i] < 255) attackArr[i]++;
    mobCount++;
    byPiece[fi]++;
  };
  const f = side === SIDE.WHITE ? 1 : -1;
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (p.side === side) {
        const fi = r * 13 + c;
        if (p.type === 'king') kingIdx = fi;
        const ray = (dr: number, dc: number): void => {
          let nr = r+dr, nc = c+dc;
          while (nr>=0&&nr<13&&nc>=0&&nc<13) { mark(nr, nc, fi); if (board[nr][nc]) break; nr+=dr; nc+=dc; }
        };
        const jump = (deltas: number[]): void => {
          for (let d = 0; d < deltas.length; d += 2) mark(r + deltas[d], c + deltas[d+1], fi);
        };
        switch (p.type) {
          case 'queen':
            ray(1,0); ray(-1,0); ray(0,1); ray(0,-1);
            ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1);
            break;
          case 'tower':
            if (p.promoted) {
              for (let d = 0; d < 8; d += 2) {
                const dr = PROM_TOWER_D[d], dc = PROM_TOWER_D[d+1];
                let nr = r+dr, nc = c+dc;
                while (nr>=0&&nr<13&&nc>=0&&nc<13) { mark(nr,nc,fi); if (board[nr][nc]) break; nr+=dr; nc+=dc; }
              }
            } else {
              ray(1,0); ray(-1,0); ray(0,1); ray(0,-1);
            }
            break;
          case 'priest':
            ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1);
            mark(r+f,c,fi); mark(r-f,c,fi);
            break;
          case 'cannon':
            for (let d = 0; d < 8; d += 2) {
              const dr = CANNON_D[d], dc = CANNON_D[d+1];
              let seen=0, nr=r+dr, nc=c+dc;
              while (nr>=0&&nr<13&&nc>=0&&nc<13) {
                if (!board[nr][nc]) { if (seen===0) mark(nr,nc,fi); }
                else { seen++; if (seen===2) { mark(nr,nc,fi); break; } }
                nr+=dr; nc+=dc;
              }
            }
            break;
          case 'king':
            for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
              if (dr===0&&dc===0) continue;
              for (let step=1;step<=2;step++) { const nr=r+dr*step, nc=c+dc*step; if (nr<0||nr>=13||nc<0||nc>=13) break; mark(nr,nc,fi); if (board[nr][nc]) break; }
            }
            break;
          case 'general': jump(DS_GENERAL); for (let i=1;i<=4;i++) { mark(r+i,c+i,fi); mark(r+i,c-i,fi); mark(r-i,c+i,fi); mark(r-i,c-i,fi); } break;
          case 'horse': jump(DS_HORSE); break;
          case 'elephant': mark(r+f,c,fi); mark(r+f,c-1,fi); mark(r+f,c+1,fi); mark(r-f,c-1,fi); mark(r-f,c+1,fi); break;
          case 'pawn': mark(r+f,c,fi); mark(r+f,c-1,fi); mark(r+f,c+1,fi); mark(r,c-1,fi); mark(r,c+1,fi); break;
          case 'archer':
            for (let d = 0; d < 16; d += 2) { const nr=r+ARCHER_D[d], nc=c+ARCHER_D[d+1]; if (!inBounds(nr,nc)) continue; if (!isOwnSide(side,nr)) continue; mark(nr,nc,fi); }
            if (onBank(side,r)) {
              mark(r+f,c-1,fi); mark(r+f,c,fi); mark(r+f,c+1,fi);
              mark(r+2*f,c-1,fi); mark(r+2*f,c,fi); mark(r+2*f,c+1,fi);
            }
            break;
          case 'carriage':
            for (let d = 0; d < 16; d += 2) {
              const dr = CARRIAGE_D[d], dc = CARRIAGE_D[d+1];
              const maxStep = (Math.abs(dr)+Math.abs(dc)===1) ? 4 : 1;
              let nr=r+dr, nc=c+dc;
              for (let step=1; step<=maxStep; step++) {
                if (!inBounds(nr,nc)) break; if (!isOwnSide(side,nr)) break;
                mark(nr,nc,fi); if (board[nr][nc]) break;
                nr+=dr; nc+=dc;
              }
            }
            break;
          case 'crossbow': jump(DS_CROSSBOW); mark(r+f,c,fi); break;
        }
      } else if (p.type === 'king') {
        enemyKingIdx = r * 13 + c;
      }
    }
  }

  if (kingIdx >= 0 && enemyKingIdx >= 0) {
    const kr = Math.floor(kingIdx / 13), kc = kingIdx % 13;
    const er = Math.floor(enemyKingIdx / 13), ec = enemyKingIdx % 13;
    const dr = Math.sign(er - kr);
    const dc = Math.sign(ec - kc);
    const sameRow = dr === 0 && dc !== 0;
    const sameCol = dc === 0 && dr !== 0;
    const sameDiag = dr !== 0 && dc !== 0 && Math.abs(er - kr) === Math.abs(ec - kc);
    if (sameRow || sameCol || sameDiag) {
      let clear = true;
      let cr = kr + dr, cc = kc + dc;
      while (cr !== er || cc !== ec) {
        if (board[cr][cc]) { clear = false; break; }
        cr += dr; cc += dc;
      }
      if (clear) mark(er, ec, kingIdx);
    }
  }

  const wrapper = makeWrapper(attackArr, byPiece, mobCount, kingIdx);
  const kingPos = kingIdx >= 0 ? { r: Math.floor(kingIdx / 13), c: kingIdx % 13 } : null;
  return {
    attackMap: wrapper.attackMap,
    byPiece: wrapper.byPiece,
    mobilityCount: { total: mobCount },
    kingPos,
  };
}

function makeWrapper(attackArr: Uint8Array, byPiece: Uint8Array, mobCount: number, kingIdx: number): { attackMap: AttackMaps['attackMap']; byPiece: AttackMaps['byPiece'] } {
  const attackMap = {
    _arr: attackArr,
    _byPiece: byPiece,
    _mobCount: mobCount,
    _kingIdx: kingIdx,
    get(k: string): number {
      const comma = k.indexOf(',');
      const r = +k.slice(0, comma), c = +k.slice(comma + 1);
      if (r < 0 || r >= 13 || c < 0 || c >= 13) return 0;
      return this._arr[r * 13 + c] || 0;
    },
    [Symbol.iterator](): Iterator<[string, number]> {
      const arr = this._arr;
      let i = -1;
      return {
        next() {
          i++;
          while (i < 169 && !arr[i]) i++;
          if (i >= 169) return { done: true, value: undefined as unknown as [string, number] };
          const r = Math.floor(i / 13), c = i % 13;
          return { done: false, value: [`${r},${c}`, arr[i]] };
        }
      };
    },
  };
  const byPieceWrapper = {
    _arr: byPiece,
    get(k: string): number {
      const comma = k.indexOf(',');
      const r = +k.slice(0, comma), c = +k.slice(comma + 1);
      if (r < 0 || r >= 13 || c < 0 || c >= 13) return 0;
      return this._arr[r * 13 + c] || 0;
    },
    [Symbol.iterator](): Iterator<[string, number]> {
      const arr = this._arr;
      let i = -1;
      return {
        next() {
          i++;
          while (i < 169 && !arr[i]) i++;
          if (i >= 169) return { done: true, value: undefined as unknown as [string, number] };
          const r = Math.floor(i / 13), c = i % 13;
          return { done: false, value: [`${r},${c}`, arr[i]] };
        }
      };
    },
  };
  return { attackMap, byPiece: byPieceWrapper };
}