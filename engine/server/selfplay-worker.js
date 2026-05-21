import { workerData, parentPort } from 'worker_threads';
import { playSelfPlayGame } from './selfplay.js';

const { botParams } = workerData;

(async () => {
  try {
    const result = await playSelfPlayGame(botParams);

    // FIX-7: Usar índice ordinal (idx) en lugar de indexOf(m) que era O(n²).
    // indexOf recorre el array entero por cada elemento → O(n²) para 1000 moves.
    // Ahora simplemente enumeramos con el índice del for loop → O(n).
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
    parentPort.postMessage(result);
  } catch (e) {
    console.error('Worker error:', e);
    parentPort.postMessage({ moves: [], finalStatus: 'stalemate', _nnFloat32: [] });
  }
})();
