# 3. Rules Engine (`src/rules/`)

The rules engine is the logical core of the game. It handles move generation, legality validation, check/mate detection, and all special game mechanics.

---

## 3.1 Engine Modules

| File | Responsibility |
|------|----------------|
| `index.js` | Re-exports the public rules engine API |
| `core.js` | Core engine: `applyMove`, `getAllLegalMoves`, drops, post-move evaluation |
| `board.js` | Board utilities: initial layout, cloning, position hashing |
| `moves.js` | Pseudo-legal and legal move generation per piece |
| `check.js` | Check detection, attacked squares, attack square generation |
| `state.js` | Palace state: curse, timers, invaders |
| `archer.js` | Archer special mechanic: ambush, blocked squares |
| `game.js` | Game state factory: `createGame()`, `resetGame()` |

---

## 3.2 Game State (`game.js`)

The `createGame()` function returns the complete game state:

```javascript
{
  board: Array[13][13],         // 13x13 board (null = empty, object = piece)
  turn: "white" | "black",     // Current turn
  selected: null,               // Player-selected piece
  legalMoves: [],               // Calculated legal moves
  reserves: {
    white: [],                  // Reusable captured pieces for white
    black: [],                  // Reusable captured pieces for black
  },
  promotionRequest: null,       // Pending promotion request
  status: "playing",            // Status: playing|checkmate|stalemate|palacemate|draw
  message: "Game ready.",       // Status message for the UI
  palaceTimers: {               // Palace siege timers
    white: { pressure: 0, invaded: false, attackerSide: null },
    black: { pressure: 0, invaded: false, attackerSide: null },
  },
  palaceTaken: { white: false, black: false },  // Palace taken?
  palaceCurse: {                // Palace curse
    white: { active: false, turnsInPalace: 0 },
    black: { active: false, turnsInPalace: 0 },
  },
  lastMove: null,               // Last move made
  lastRepeatedMoveKey: null,    // Key of last repeated move
  repeatMoveCount: 0,           // Consecutive repetition counter
  positionHistory: Map,         // Position history for repetition detection
}
```

### Piece Structure

```javascript
{
  id: "uuid-v4",      // Unique identifier (crypto.randomUUID())
  type: "king",        // Type: king|queen|general|elephant|priest|horse|cannon|tower|carriage|archer|pawn|crossbow
  side: "white",       // Side: white|black
  promoted: false,     // Is it promoted?
  locked: false,       // Is it locked? (internal use)
}
```

---

## 3.3 Move Generation (`moves.js`)

### Move Pipeline

```
pseudoMovesForPiece()      ← Generates all possible moves without checking legality
       │
       ▼
getLegalMovesForSquare()   ← Filters pseudo-moves:
       │                      1. Type restrictions (archer/carriage on own side)
       │                      2. Cannot end on the river
       │                      3. Cannot capture own pieces
       │                      4. Cannot move to squares protected by enemy archer
       │                      5. Own king check verification (simulate + check)
       ▼
  Final legal moves
```

### Function `pseudoMovesForPiece(board, piece, r, c, state)`

Generates pseudo-legal moves based on piece type. Each move returns:

```javascript
{
  r: number,           // Destination row
  c: number,           // Destination column
  capture: boolean,    // Is it a capture?
  special: string|null // Special move (optional)
}
```

### Function `getLegalMovesForSquare(state, r, c)`

1. Gets pseudo-moves from `pseudoMovesForPiece`.
2. Filters movement restrictions:
   - Archers and carriages can only move on their own side.
   - No piece can end on the river row.
   - Cannot move to squares protected by enemy archer.
3. Simulates each move and verifies the own king is not in check.
4. Returns only legal moves.

### Movement Utilities

| Function | Description |
|----------|-------------|
| `rayMoves(board, piece, r, c, dirs, maxSteps)` | Generates straight-line moves (tower, queen, priest). Stops upon encountering a piece. |
| `jumpMoves(board, piece, r, c, deltas)` | Generates jumps to fixed positions (horse-like). |
| `addIfValid(moves, board, piece, fromR, fromC, toR, toC)` | Adds move if in bounds and not capturing own piece. |

---

## 3.4 Core Engine (`core.js`)

### `applyMove(state, action)`

Applies a move to the game state. Handles:

1. **Reserve drops:** Removes piece from reserve and places it on the board.
2. **Normal moves:** Moves piece from origin to destination. If capture:
   - Reusable captured piece → goes to captor's reserve.
   - Non-reusable piece → permanently removed.
3. **Promotion:** If piece reaches promotion zone and the player chooses to promote.
4. **Palace update:** Calls `updatePalaceState()`.
5. **Turn change:** `state.turn = opponent(state.turn)`.
6. **Archer ambush:** If an archer reaches the bank, checks for victims.
7. **Position history:** Records position signature for repetition detection.

### `getAllLegalMoves(state, side)`

Generates **all** legal moves for a side:

1. Iterates over all pieces of the side on the board → `getLegalMovesForSquare()`.
2. Adds legal reserve drops → `getLegalReserveDrops()`.
3. Returns list of `{ from: {r,c}, to: {r,c} }` and drops `{ fromReserve: true, reserveIndex, to }`.

### `getLegalReserveDrops(state, side)`

Generates legal drops from reserve:

1. For each piece in reserve, iterates over all empty squares.
2. Verifies: empty square, not river, correct side, not protected by enemy archer.
3. Simulates the drop and verifies the own king is not in check.

### `afterMoveEvaluation(state)`

Post-move evaluation that detects end-game conditions:

1. **Triple repetition:** If the current position has occurred 3 times → draw.
2. **No legal moves:**
   - In check → **checkmate** (active player loses).
   - Not in check → **stalemate** (draw).
3. **Palace mate:** If the king is trapped inside its own palace with enemies inside and no escape or possibility of expelling the invaders.
4. **Palace taken:** If a palace has been under siege long enough.

---

## 3.5 Check Detection (`check.js`)

### `isKingInCheck(state, side)`

Checks if the king of the given side is in check:

1. Locates the king on the board with `findKings()`.
2. Calls `isSquareAttacked(board, king.r, king.c, opponent(side), state)`.
3. Returns `true` if the king's square is attacked.

### `isSquareAttacked(board, r, c, bySide, state)`

Checks if a square is attacked by any piece of the `bySide`:

1. For each piece of the attacking side, generates their attack squares with `attackSquaresForPiece()`.
2. If any attack square matches `(r, c)` → square is attacked.
3. **Special case:** King confrontation in the same column with no intermediate pieces (rule inherited from Xiangqi).

### `attackSquaresForPiece(board, piece, r, c, state)`

Generates the squares a piece attacks (not necessarily where it can legally move). Similar to `pseudoMovesForPiece` but used specifically for threat detection.

---

## 3.6 Board (`board.js`)

### Board Functions

| Function | Description |
|----------|-------------|
| `makePiece(type, side, promoted)` | Creates a piece object with unique UUID |
| `initialLayout()` | Generates the board with the initial piece layout |
| `findKings(board)` | Locates both kings: `{ white: {r,c,piece}, black: {r,c,piece} }` |
| `boardSignature(state)` | Generates a compact state signature (for repetition detection) |
| `cloneState(state)` | Deep clone of the complete state (for simulation in search) |
| `lineClear(board, r1,c1, r2,c2)` | Checks if there are no pieces between two positions in line |
| `countBetween(board, r1,c1, r2,c2)` | Counts pieces between two positions (for cannon) |
| `pathSquares(r1,c1, r2,c2)` | Lists all squares between two positions |

---

## 3.7 Palace State (`state.js`)

### `updatePalaceState(state)`

Called after each move to update palace state:

1. For each side, checks if there are enemy pieces inside the palace.
2. **If there are invaders:**
   - Increments `palaceTimers[side].pressure`.
   - If pressure reaches 3 → `palaceTaken[side] = true`.
   - Increments `palaceCurse[side].turnsInPalace`.
   - If turns in palace reach 3 → activates curse (`palaceCurse[side].active = true`).
3. **If no invaders:** Resets all counters.

### `isPalaceCursedFor(state, side)`

Returns `true` if the palace curse is active for the given side. The curse modifies King and Queen movement.

### `getPalaceInvaders(state, side)`

Returns a list of enemy pieces currently inside the given side's palace.

---

## 3.8 Archer Mechanic (`archer.js`)

### `getArcherBlockedSquares(archerRow, archerCol, archerSide)`

Calculates the 3 squares an archer on the bank blocks:
- The square directly ahead (2 rows forward crossing the river).
- The front-left and front-right diagonal squares.

### `isSquareProtectedByArcher(state, targetRow, targetCol, protectorSide)`

Checks if a square is in the blocked zone of any archer of the protector side. Pieces cannot move to or drop on squares protected by enemy archers.

### `getArcherAmbushResult(state, archer, bankPos)`

Calculates the result of an ambush when an archer reaches the bank:
- **`null`:** No victims.
- **`singleCapture`:** One victim → automatic capture.
- **`autoCaptureAll`:** All victims cannot retreat → mass capture.
- **`chooseCapture`:** Multiple victims → player chooses.

### `executeArcherAmbush(state, choice)`

Executes the chosen ambush: captures the selected victim, retreats the others (if they can), or captures them (if they cannot retreat).
