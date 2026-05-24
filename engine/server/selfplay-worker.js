import { workerData, parentPort } from 'worker_threads';
import { playSelfPlayGame } from './selfplay.js';
import { PackedBoard } from '../ai/packed-state.js';
import { SharedTT } from '../ai/shared-tt.js';

const { botParams, sharedTTBuffer, workerIndex } = workerData;

// Attach to shared transposition table if available
let sharedTT = null;
if (sharedTTBuffer) {
  sharedTT = new SharedTT(500_000, sharedTTBuffer);
}

(async () => {
  try {
    const result = await playSelfPlayGame(botParams);

    // FIX-7: Usar índice ordinal (idx) en lugar de indexOf(m) que era O(n²).
    // ES: índice ordinal O(n) en lugar de indexOf O(n²).
    const nnData = [];
    for (let idx = 0; idx < result.moves.length; idx++) {
      const m = result.moves[idx];
      if (m._nnFloat32) {
        nnData.push({
          idx,
          nn: Array.from(m._nnFloat32),
        });
      }
    }

    result._nnFloat32 = nnData;

    // Send packed stateAfter in transferable format
    // ES: Enviar stateAfter en formato transferible (ArrayBuffer)
    if (result.moves && result.moves.length > 0) {
      const transferBuffers = [];
      for (const m of result.moves) {
        // Each move's stateAfter is already a Uint8Array from PackedBoard.pack()
        // We'll send them as transferable buffers via postMessage
        if (m.stateAfter && m.stateAfter.buffer instanceof ArrayBuffer) {
          transferBuffers.push(m.stateAfter.buffer);
        }
      }
      parentPort.postMessage(result, transferBuffers.length > 0 ? transferBuffers : undefined);
    } else {
      parentPort.postMessage(result);
    }
  } catch (e) {
    console.error('Worker error:', e);
    parentPort.postMessage({ moves: [], finalStatus: 'stalemate', _nnFloat32: [] });
  }
})();