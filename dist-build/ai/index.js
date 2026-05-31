// AI Module Index - TypeScript
export { chooseBotMove, chooseBlackBotMove, queueAdaptiveMemorySave, loadAdaptiveMemory } from './bot.ts';
export { evaluate, gamePhaseFactor, buildAttackMap, setNNPredictFn, clearNNCache, clampNNScore, blendScoreWithNN, encodeBoardForNN } from './evaluation.ts';
export { search, searchRoot, allocateTime, moveKey, moveKeyUint32, decayHistoryTable, GameDanceTracker } from './search.ts';
export { makeMove, unmakeMove, pieceSquareBonus, seeValue, isSEEPositive } from './moves.ts';
export { computeFullHash, TranspositionTable, TT_EXACT, TT_ALPHA, TT_BETA } from './hashing.ts';
export { adaptiveMemory, extractFeatures } from './memory.ts';
export { pieceValue, PIECE_VALUES, PROMOTED_VALUES } from './piece-values.ts';
export { createIncrementalMaps, IncrementalAttackMap } from './incremental-attack.ts';
export { buildAttackMap as buildAttackMapFn } from './attack-map.ts';
