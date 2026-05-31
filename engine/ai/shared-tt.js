const TT_ENTRIES = 4;
export const TT_EXACT = 0;
export const TT_ALPHA = 1;
export const TT_BETA = 2;
// Each entry: [hash_lo, hash_hi, score, depth_flag_move]
const HASH_LO = 0, HASH_HI = 1, SCORE = 2, DEPTH_FLAG_MOVE = 3;
export class SharedTT {
    size;
    buffer;
    data;
    entryCount;
    constructor(maxSize, buffer) {
        this.size = 1;
        while (this.size < maxSize)
            this.size <<= 1;
        const byteSize = this.size * TT_ENTRIES * 4;
        this.buffer = buffer ? buffer.slice(0, byteSize) : new SharedArrayBuffer(byteSize);
        this.data = new Uint32Array(this.buffer);
        this.entryCount = 0;
    }
    _idx(hash) {
        return Number(hash & BigInt(this.size - 1));
    }
    get(key) {
        const base = this._idx(key) * TT_ENTRIES;
        const storedLo = this.data[base + HASH_LO];
        const storedHi = this.data[base + HASH_HI];
        const keyLo = Number(key & 0xffffffffn);
        const keyHi = Number((key >> 32n) & 0xffffffffn);
        if (storedLo !== keyLo || storedHi !== keyHi)
            return undefined;
        const score = this.data[base + SCORE] | 0;
        const depthFlagMove = this.data[base + DEPTH_FLAG_MOVE];
        const depth = (depthFlagMove >> 8) & 0xFF;
        const flag = (depthFlagMove >> 6) & 0x3;
        const bestMoveKey = depthFlagMove & 0xFFFFFF;
        return { depth, score, flag, bestMoveKey };
    }
    set(key, value) {
        const base = this._idx(key) * TT_ENTRIES;
        const existingDepth = (this.data[base + DEPTH_FLAG_MOVE] >> 8) & 0xFF;
        if (existingDepth > value.depth)
            return;
        this.data[base + HASH_LO] = Number(key & 0xffffffffn);
        this.data[base + HASH_HI] = Number((key >> 32n) & 0xffffffffn);
        this.data[base + SCORE] = value.score;
        const packed = ((value.depth & 0xFF) << 8) | ((value.flag & 0x3) << 6) | ((value.bestMoveKey ?? 0) & 0x3F);
        this.data[base + DEPTH_FLAG_MOVE] = packed;
        this.entryCount++;
    }
    approximateSize() {
        return this.entryCount;
    }
}
