# 5. AI Engine (`src/ai/`)

The AI engine implements an automatic player based on Minimax search with multiple advanced optimizations. It is designed to play as the black side, although it can be used for any side.

---

## 5.1 AI Modules

| File | Responsibility |
|------|----------------|
| `index.js` | Re-exports the public AI API |
| `bot.js` | Bot controller: IDS + Aspiration Windows |
| `search.js` | Alpha-Beta search with advanced optimizations |
| `evaluation.js` | Complete positional evaluation function |
| `hashing.js` | Zobrist hashing + Transposition Table |
| `moves.js` | Efficient makeMove/unmakeMove + SEE (Static Exchange Evaluation) |
| `memory.js` | Adaptive memory: online learning from games |

---

## 5.2 Bot Controller (`bot.js`)

### `chooseBlackBotMove(state, options)`

Main entry point for the bot to choose a move.

**Parameters:**

| Option | Default | Description |
|--------|---------|-------------|
| `maxDepth` | 8 | Maximum search depth |
| `timeLimitMs` | 500 | Time limit in milliseconds |
| `aspirationWindow` | 45 | Initial aspiration window |

**Algorithm:**

1. Gets a fallback move (first legal move) for safety.
2. Initializes the transposition table (500K entries) and computes the Zobrist hash.
3. **Iterative Deepening Search (IDS):** Searches from depth 1 up to `maxDepth`:
   - Uses **Aspiration Windows** to narrow the alpha-beta window.
   - If it fails below alpha → re-searches with `alpha = -∞`.
   - If it fails above beta → re-searches with `beta = +∞`.
   - Stops if it finds mate or runs out of time.
4. Returns `{ move, score }`.

**Time management:**

```javascript
allocateTime(startTime, totalMs, movesLeft)
// Distributes available time considering remaining moves
```

### Memory Persistence

- `queueAdaptiveMemorySave()`: Saves adaptive memory to the server with 500ms debounce.
- `loadAdaptiveMemory()`: Loads memory from `/api/memory` on startup.
- `beforeunload`: Uses `navigator.sendBeacon` to save before closing the tab.

---

## 5.3 Search (`search.js`)

### Main Algorithm: Alpha-Beta with Optimizations

```
searchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore)
    │
    ├─ search(state, depth, alpha, beta, deadline, tt, hash, ...)  ← Recursive
    │      │
    │      ├─ Repetition detection (contempt = ±150)
    │      ├─ Transposition table (TT) lookup
    │      ├─ Terminal check (mate/stalemate)
    │      ├─ Razoring (depth ≤ 2)
    │      ├─ Null Move Pruning (depth ≥ 3, R=2-3)
    │      ├─ ProbCut (depth ≥ 3)
    │      ├─ Move ordering
    │      ├─ LMR (Late Move Reductions)
    │      ├─ Futility Pruning
    │      ├─ Multi-Cut (depth ≥ 3)
    │      └─ TT storage
    │
    └─ quiescence(state, alpha, beta, deadline, hash, staticEval)
           │
           └─ Only tactical moves (captures + promotions)
               with SEE filtering
```

### Implemented Optimizations

#### 5.3.1 Iterative Deepening Search (IDS)

Searches incrementally from depth 1 to maximum. Advantages:
- Better move ordering (uses previous results).
- Granular time control.
- Guarantees always having a valid move.

#### 5.3.2 Aspiration Windows

Narrow the alpha-beta window around the previous score (±45). If the search fails outside the window, it re-searches with the full window.

#### 5.3.3 Transposition Table (TT)

Caches evaluated positions with their Zobrist hash:
- **EXACT:** Exact score found.
- **ALPHA:** Upper bound (alpha not improved).
- **BETA:** Lower bound (caused cutoff).

Capacity: 500,000 entries with LRU eviction.

#### 5.3.4 Null Move Pruning

If passing the turn (not moving) and the opponent is still losing → prune this branch.
- **Conditions:** depth ≥ 3, not in check, no drops available, no palace curse.
- **Reduction R:** 3 for depth > 6, 2 for depth ≤ 6.

#### 5.3.5 Late Move Reductions (LMR)

Moves evaluated later in the list (probably worse) are searched with reduced depth:
- Applied from move #4 onwards.
- Base reduction: `log2(moveIndex) * log2(depth) * 0.4`.
- If the reduced search improves alpha → re-search at full depth.

#### 5.3.6 Futility Pruning

If the static score + a margin cannot improve alpha, prune:
- Margin by depth: `[0, 150, 300, 500]`.

#### 5.3.7 Razoring

At low depths (≤ 2), if the static score is far below alpha (or above beta), jump directly to quiescence search.

#### 5.3.8 ProbCut

At depth ≥ 3, does a quick search at `depth - 4` with a narrow window. If the result exceeds beta + margin → prune.

#### 5.3.9 Multi-Cut

At depth ≥ 3, if multiple moves cause cutoff in reduced search → prune the entire branch.

#### 5.3.10 Quiescence Search

Extends the search in tactical positions (captures, promotions, checks):
- SEE filtering: Only explores profitable captures.
- Prevents the horizon effect.

### Repetition Detection in Search

```javascript
// 3rd repetition → draw with contempt
const DRAW_CONTEMPT = 150;
// If the bot (black) is winning → draw is worth -150 (rejects it)
// If it's losing → draw is worth +150 (seeks it)

// 2nd repetition → 600 penalty in static evaluation
// so it searches for alternatives before the third
```

### Move Ordering

Moves are ordered by score to maximize pruning:

| Priority | Criterion | Bonus |
|----------|-----------|-------|
| 1 | TT move | +1,000,000 |
| 2 | Capture of valuable piece with cheap piece | +captured value × 100 |
| 3 | Killer moves (moves that caused cutoff at neighboring depths) | +900 / +650 |
| 4 | History heuristic (moves that historically cause cutoffs) | variable |
| 5 | Drops to central squares | +50 |
| 6 | Adaptive memory penalty | -variable |

---

## 5.4 Evaluation (`evaluation.js`)

### `evaluate(state, hash, precomputedMaps)`

Static evaluation function that returns `{ score, metrics }`.

**Score convention:** Positive = advantage for Black, Negative = advantage for White.

### Evaluation Components

#### 5.4.1 Material

Sum of piece values (see table in section 4.1). Difference Black - White.

#### 5.4.2 Piece-Square Tables

Positional bonus by piece location:

| Piece | Bonus Factors |
|-------|---------------|
| Pawn | Progress × 12 + river crossing + promotion |
| Horse | Centralization (distance to center) |
| Cannon | Progress × 4 |
| Tower | Progress × 4 |
| Priest | Base +16 |
| Archer | +300 on bank + progress × 10 |
| King | +90 in palace, -70 outside palace |
| Queen | Base +35 |
| General | Base +18 |

#### 5.4.3 Hanging Pieces Penalty

If a piece is attacked by the enemy:
- Base penalty: `value × 0.42 × number_of_attackers`.
- Extra penalty if attacked by multiple pieces.
- Extra penalty if the piece has no mobility (cannot flee).

#### 5.4.4 Doubled Pawns

Penalty of 22 points for each additional pawn in the same column.

#### 5.4.5 Palace Pressure

- +50 per own piece in the enemy palace.
- +110 per own piece (if white) in the enemy palace.
- Progressive bonus for towers/queens/cannons near the enemy palace.

#### 5.4.6 Center Control

An attack map is calculated for each side and scored:
- Central squares (rows 4-8, columns 4-8): +1 per attack.
- Enemy palace squares: +5 per attack.

#### 5.4.7 Attacks on Valuable Pieces

Bonus if attacking enemy pieces with value > 300.

#### 5.4.8 Reserve Value

Points for pieces in reserve (drop potential).

#### 5.4.9 Mobility

`MOBILITY_WEIGHT = 9` points per available legal move (difference between sides).

#### 5.4.10 King Safety

`kingSafetyFast()` function:
- King shield: bonus for own pieces adjacent to the king.
- King attacks: penalty for enemy pieces attacking zones near the king.
- King escape routes: penalty if the king has few escape squares.

#### 5.4.11 Palace State

- `palaceTaken`: ±350 points.
- Active `palaceCurse`: ±300 base points + 40 per additional turn under curse.

#### 5.4.12 Imminent Palace Invasion

Bonus for pieces about to invade the enemy palace.

#### 5.4.13 Tempo

Bonus of 15 points for having the turn.

#### 5.4.14 Repetition Penalty

Penalty to discourage position repetition.

#### 5.4.15 Adaptive Memory

Evaluation adjustment based on accumulated experience from previous games (feature scores + pattern weights).

### Game Phase

```javascript
gamePhaseFactor(board)
// 0.0 = endgame (few pieces)
// 1.0 = opening (many pieces)
// Calculated by total material excluding pawns and kings
```

Some evaluation components are scaled by phase: king safety matters more in the opening, pawn advancement matters more in the endgame.

### Build Attack Map

```javascript
buildAttackMap(board, side)
// Returns: { attackMap, mobilityCount, byPiece, kingPos }
// attackMap: Map<"r,c" → count>  (how many pieces attack each square)
// mobilityCount: { total }       (total possible moves)
// byPiece: Map<"r,c" → count>    (mobility of each individual piece)
// kingPos: { r, c }               (king position)
```

---

## 5.5 Zobrist Hashing (`hashing.js`)

### Concept

Zobrist hashing generates a 64-bit unique identifier for each board position. It allows:
- O(1) repeated position detection.
- Efficient storage in the transposition table.
- Incremental update (XOR when moving pieces).

### Zobrist Tables

```javascript
ZobristTable[r][c][side][pieceType][promoted]  // One hash per combination
ZobristReserve[side][pieceType][count]          // Hash per reserve
ZobristTurn[0], ZobristTurn[1]                  // Turn hash
ZobristPalaceWhite, ZobristPalaceBlack          // Palace taken hash
```

### Operations

| Function | Description |
|----------|-------------|
| `computeFullHash(state)` | Computes the full hash of a position from scratch |
| `xorPiece(hash, r, c, piece)` | Updates hash when adding/removing a piece |
| `xorReserves(hash, reserves, sideIdx)` | Updates hash for reserve changes |

### Transposition Table

```javascript
class TranspositionTable {
  constructor(maxSize = 500_000)
  get(key)      // Returns entry if exists (and updates age)
  set(key, val) // Stores with 10% LRU eviction when full
}
```

Each entry stores:

```javascript
{
  score: number,        // Position score
  depth: number,        // Depth at which it was evaluated
  flag: TT_EXACT|TT_ALPHA|TT_BETA,
  bestMoveKey: string,  // Best move found
  age: number,          // For LRU eviction
}
```

---

## 5.6 Make/Unmake Move (`moves.js`)

### `makeMove(state, move, promote, currentHash, currentEval)`

Applies a move efficiently for search:

1. Saves the undo state (modified cells, turn, reserves, palace, history).
2. Computes incremental `evalDiff` (estimated evaluation difference without recalculating everything).
3. Updates the Zobrist hash incrementally.
4. Calls `applyMove()` from the rules engine.
5. Returns `{ action, undo, hash, evalDiff }`.

### `unmakeMove(state, { undo })`

Reverts a move using the undo data:
- Restores board cells.
- Restores turn, reserves, palace, history.

### Static Exchange Evaluation (SEE)

```javascript
isSEEPositive(state, move, buildAttackMap)
// Evaluates if a capture is profitable considering recaptures
// Used in quiescence to filter losing captures
```

### Piece Values

```javascript
PIECE_VALUES = {
  king: 0,    queen: 950,  general: 560, elephant: 240,
  priest: 400, horse: 320,  cannon: 450,  tower: 520,
  carriage: 390, archer: 450, pawn: 110, crossbow: 240,
};
PROMOTED_VALUES = {
  pawn: 240, tower: 650, horse: 430,
  elephant: 320, priest: 540, cannon: 540,
};
```

---

## 5.7 Adaptive Memory (`memory.js`)

### `AdaptiveMemory` Class

Online learning system that improves evaluation with experience:

#### Stored Data

| Field | Type | Description |
|-------|------|-------------|
| `moveScores` | Map | Accumulated score per move (key: moveKey) |
| `featureScores` | Map | Score per feature key (positional state) |
| `blunderMoves` | Map | Moves that historically result in serious errors |
| `drawPositions` | Map | Positions that lead to draws |
| `patternWeights` | Object | Adjustable strategic pattern weights |
| `gamesPlayed` | number | Total games played |
| `gamesWon` | number | Total games won |

#### Strategic Patterns (Pattern Weights)

```javascript
{
  centerControl: 1.0,    // Importance of center control
  pieceActivity: 1.0,     // Importance of piece activity
  kingSafety: 1.0,        // Importance of king safety
  materialBalance: 1.0,   // Importance of material balance
  pawnStructure: 1.0,     // Importance of pawn structure
  palacePressure: 1.0,    // Importance of palace pressure
}
```

Adjusted after each game using a learning rate of 0.12.

#### Feature Extraction

```javascript
extractFeatures(state, side)
// Generates a key like: "ap:1|pp:2|r:0|er:1|pt:0|ept:0|cu:0|ecu:0"
// ap = archers on bank
// pp = palace pressure (0-3)
// r = reserve count
// er = enemy reserve count
// pt = palace taken
// ept = enemy palace taken
// cu = curse active
// ecu = enemy curse active
```

#### Error Thresholds

```javascript
BLUNDER_THRESHOLD = 200  // Evaluation loss > 200 = blunder
MISTAKE_THRESHOLD = 80   // Evaluation loss > 80 = mistake
DECAY_RATE = 0.02        // Memory decay rate
```

#### Memory Pruning

- `moveScores`: Maximum 4,000 entries (prunes oldest 20%).
- `featureScores`: Maximum 3,000 entries.
- `blunderMoves`: Maximum 2,000 entries.
- `drawPositions`: Maximum 20,000 entries.

#### Serialization

```javascript
toJSON()   // Converts Maps to entry arrays for JSON
fromJSON() // Reconstructs Maps from arrays
```

---

## 5.8 Difficulty Levels

The UI offers 10 difficulty levels that adjust search parameters:

| Level | Name | Depth | Time (ms) |
|-------|------|-------|-----------|
| 1 | Beginner | 1-2 | ~100 |
| 2 | Easy | 2-3 | ~150 |
| 3 | Easy+ | 3-4 | ~200 |
| 4 | Intermediate- | 4-5 | ~250 |
| 5 | Intermediate | 5-6 | ~300 |
| 6 | Intermediate+ | 6 | ~400 |
| 7 | Advanced- | 6-7 | ~500 |
| 8 | Advanced | 7-8 | ~600 |
| 9 | Expert | 8 | ~800 |
| 10 | Master | 8+ | ~1000+ |
