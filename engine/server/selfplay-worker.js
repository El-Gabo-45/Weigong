import { workerData, parentPort } from 'worker_threads';
import { playSelfPlayGame } from './selfplay.js';

const { botParams } = workerData;

(async () => {
  try {
    const result = await playSelfPlayGame(botParams);

    // Serialize moves including _nnFloat32 for GPU training
    // ES: Serializar moves incluyendo _nnFloat32 para entrenamiento GPU
    // (transfer as Transferable for better performance)
    // ES: (transferir como Transferable para mejor rendimiento)
    const nnData = [];
    for (const m of result.moves) {
      if (m._nnFloat32) {
        nnData.push({
          turn: m.turn ?? result.moves.indexOf(m) + 1,
          nn: Array.from(m._nnFloat32),
        });
        // Don't send the huge Float32Array
        // ES: No enviar el Float32Array enorme
        delete m._nnFloat32;
        delete m.boardSnapshot;
      }
    }

    // Add serialized NN data to the result so server.js can receive it
    // ES: Agregar los datos NN serializados al resultado para que server.js los reciba
    result._nnFloat32 = nnData;

    parentPort.postMessage(result);
  } catch (e) {
    console.error('Worker error:', e);
    parentPort.postMessage({ moves: [], finalStatus: 'stalemate', _nnFloat32: [] });
  }
})();
