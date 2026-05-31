// AI Module Index - TypeScript
export { chooseBotMove, chooseBlackBotMove, queueAdaptiveMemorySave, loadAdaptiveMemory } from './bot.js';
export { evaluate, gamePhaseFactor, buildAttackMap, setNNPredictFn, clearNNCache, clampNNScore, blendScoreWithNN, encodeBoardForNN } from './evaluation.js';
export { search, searchRoot, allocateTime, moveKey, moveKeyUint32, decayHistoryTable, GameDanceTracker } from './search.js';
export { makeMove, unmakeMove, pieceSquareBonus, seeValue, isSEEPositive } from './moves.js';
export { computeFullHash, TranspositionTable, TT_EXACT, TT_ALPHA, TT_BETA } from './hashing.js';
export { adaptiveMemory, extractFeatures } from './memory.js';
export { pieceValue, PIECE_VALUES, PROMOTED_VALUES } from './piece-values.js';
export { createIncrementalMaps, IncrementalAttackMap } from './incremental-attack.js';
export { buildAttackMap as buildAttackMapFn } from './attack-map.js';
