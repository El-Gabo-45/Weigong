import { workerData, parentPort } from 'worker_threads';
import { playSelfPlayGame } from './selfplay.js';

const { botParams } = workerData;

(async () => {
  try {
    const result = await playSelfPlayGame(botParams);

    // Serializar moves incluyendo _nnFloat32 para GPU training Serialyze the moves including _nnFloat32 for GPU training
    // (transferir como Transferable para mejor performance) Transfer as Transferable for better performance
    const nnData = [];
    for (const m of result.moves) {
      if (m._nnFloat32) {
        nnData.push({
          turn: m.turn ?? result.moves.indexOf(m) + 1,
          nn: Array.from(m._nnFloat32),
        });
        // No enviar el Float32Array enorme Don't send the huge Float32Array
        delete m._nnFloat32;
        delete m.boardSnapshot;
      }
    }
    result._nnFloat32 = nnData;

    parentPort.postMessage(result);
  } catch (e) {
    console.error('Worker error:', e);
    parentPort.postMessage({ moves: [], finalStatus: 'stalemate', _nnFloat32: [] });
  }
})();
