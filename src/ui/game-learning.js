import { SIDE } from "../../engine/constants.js";
import { boardSnapshotToJSON } from "./board-snapshot.js";
import { adaptiveMemory, queueAdaptiveMemorySave } from "../../engine/ai/index.js";
import pako from 'pako';

async function sendGameForLearning(movesArray, finalStatus, result) {
  if (!movesArray || movesArray.length === 0) return;
  const gameData = {
    id: Date.now(), timestamp: new Date().toISOString(), finalStatus, result, totalMoves: movesArray.length,
    moves: movesArray.map((m, i) => ({
      turn: i + 1, side: m.side === SIDE.BLACK ? 'black' : 'white',
      moveKeyStr: m.moveKeyStr ?? null, featureKey: m.featureKey ?? null,
      evalBefore: m.evalBefore ?? null, evalAfter: m.evalAfter ?? null,
      metrics: m.metrics ?? null, notation: m.notation ?? '',
      // BigInt can't be JSON.stringify'd — convert to string if present
      // ES: BigInt no se puede serializar con JSON.stringify — convertir a string
      positionHash: m.positionHash != null ? String(m.positionHash) : null,
      boardSnapshot: m.boardSnapshot ? (m.boardSnapshot instanceof Int16Array ? boardSnapshotToJSON(m.boardSnapshot) : m.boardSnapshot) : undefined,
    })),
  };
  try {
    const compressed = pako.gzip(JSON.stringify(gameData));
    await fetch('/api/saveGame', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: compressed });
    await fetch('/api/learnFromGames', { method: 'POST' });
  } catch (e) { console.error('Error guardando/aprendiendo:', e); }
}

async function finalizeHumanGame(state, V, gameMovesData) {
  if (gameMovesData.length === 0) return;
  let result = 'draw';
  if (state.status === 'checkmate') {
    result = state.turn === SIDE.WHITE ? 'black_win' : 'white_win';
  } else if (state.status === 'palacemate') {
    result = state.turn === SIDE.WHITE ? 'black_win' : 'white_win';
  } else {
    result = 'draw';
  }
  const movesSnapshot = [...gameMovesData];
  await sendGameForLearning(movesSnapshot, state.status, result);
  adaptiveMemory.recordGame(result, movesSnapshot);
  if (result === 'draw') { adaptiveMemory.recordDrawGame(movesSnapshot, state.status); }
  queueAdaptiveMemorySave();
  return movesSnapshot;
}

export { sendGameForLearning, finalizeHumanGame };