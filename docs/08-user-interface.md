# 8. User Interface

The game's web interface is built with HTML5, CSS3, and vanilla JavaScript (no frameworks), using ES Modules directly in the browser.

---

## 8.1 Entry Point (`index.html`)

The HTML defines the complete UI structure:

### Main Layout

```html
<div id="app">
  ├── <header>               <!-- Logo + title "Wéigōng 圍宮" -->
  │
  ├── <div id="reserveBlack">  <!-- Black piece reserve -->
  │
  ├── <div id="board">         <!-- 13×13 board (CSS grid) -->
  │
  ├── <div id="reserveWhite">  <!-- White piece reserve -->
  │
  ├── <div id="controls">      <!-- Control panel -->
  │   ├── turnLabel            <!-- Turn indicator -->
  │   ├── phaseLabel           <!-- Phase indicator -->
  │   ├── difficultySelect     <!-- Difficulty selector (1-10) -->
  │   ├── resetBtn             <!-- Reset button -->
  │   ├── botToggleBtn         <!-- Enable/disable bot -->
  │   ├── aiVsAiBtn            <!-- AI vs AI mode -->
  │   ├── trainBtn             <!-- Training mode -->
  │   ├── loadGameBtn          <!-- Load saved game -->
  │   └── loadGameInput        <!-- File input for game -->
  │
  ├── <div id="rulesSummary">  <!-- Rules summary -->
  │
  ├── <div id="messageBar">    <!-- Status message bar -->
  │
  ├── <div id="moveTimeline">  <!-- Move timeline -->
  │
  ├── <div id="promotionModal">  <!-- Promotion modal -->
  │
  ├── <div id="ambushModal">     <!-- Ambush modal -->
  │
  └── <div id="dbgPanel">       <!-- Debug panel (dev) -->
</div>
```

### Import Map

```html
<script type="importmap">
{
  "imports": {
    "pako": "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.esm.mjs"
  }
}
</script>
<script type="module" src="src/main.js"></script>
```

---

## 8.2 Global State (`src/state.js`)

### `state` Object

Game state created by `createGame()`:
- `board[13][13]`: Board.
- `turn`: Current turn.
- `reserves`: Pieces in reserve.
- `selected`: Selected piece.
- `legalMoves`: Calculated legal moves.
- `status`: Game status.
- `palaceCurse`, `palaceTaken`, `palaceTimers`: Palace state.

### `V` Object (Mutable Variables)

All application mutable variables in a single object:

```javascript
V = {
  totalMoves: 0,           // Total moves played
  currentGameNotation: [],  // Current game notation array
  gameMovesData: [],        // Detailed data for each move
  humanGameFinalized: false, // Has the human game been finalized?

  aiVsAiMode: false,        // AI vs AI mode active
  aiVsAiRunning: false,     // AI vs AI running
  aiVsAiMoves: [],          // AI vs AI game moves

  trainingMode: false,      // Training mode active
  trainingCount: 0,         // Completed training games
  trainingRunning: false,   // Training running

  selectedReserve: null,     // Selected reserve piece
  pendingMove: null,         // Pending move (awaiting confirmation)
  pendingAmbush: null,       // Pending ambush (awaiting choice)
  botEnabled: false,         // Bot enabled
  botThinking: false,        // Bot computing move
  botTimeout: null,          // Bot timer
  botToken: 0,               // Token to cancel stale computations

  timelineSnapshots: [],     // Snapshots for temporal navigation
  viewPly: 0,                // Currently viewed ply
};
```

### DOM References

All DOM elements are exported as constants:
- `boardEl`, `turnLabel`, `phaseLabel`, `reserveWhite`, `reserveBlack`
- `resetBtn`, `botToggleBtn`, `promotionModal`, `ambushModal`
- `difficultySelect`, `aiVsAiBtn`, `trainBtn`, `messageBar`
- `moveTimeline`, `loadGameBtn`, `loadGameInput`

### `COLS` Constant

```javascript
COLS = "ABCDEFGHIJKLM"  // Column letters for notation
```

---

## 8.3 Gameplay (`src/ui/gameplay.js`)

### `render()` Function

Main rendering function that updates the entire UI:

1. **Board:** Clears and regenerates all 169 cells:
   - River cells → `river-cell` class.
   - Palace cells → `palace-cell` class.
   - Pieces → `pieceLabel()` with kanji and side color.
   - Last move → `last-move-cell` class.
   - Legal moves → `legal-move-cell` class.
   - Selected piece → `selected-cell` class.
2. **Reserves:** Shows capturable pieces for each side.
3. **Controls:** Updates turn, phase, and status indicators.
4. **Message bar:** Shows the current status message.
5. **Rules summary:** Updates cursed/palace information.

### Board Interaction

```
Cell click
    │
    ├─ Is there a selected piece?
    │   ├─ Is the click a legal move? → executeBoardMove()
    │   └─ Is the click another own piece? → select new piece
    │
    └─ No selection?
        ├─ Click on own piece? → select, compute legalMoves
        └─ Click on empty? → deselect
```

### `executeBoardMove(move)`

1. Applies the move with `applyMove()`.
2. Checks for archer ambush → `executeArcherAmbush()`.
3. Evaluates post-move → `afterMoveEvaluation()`.
4. Records timeline snapshot.
5. Generates algebraic notation.
6. If bot is enabled → schedules `handleBotTurn()` with delay.
7. Re-renders.

### `handleBotTurn()`

1. Generates a unique token for this computation.
2. Sends the position to the server (`/api/bot`) or computes locally.
3. If the token is still valid → applies the bot's move.
4. Checks promotion, ambush, end of game.
5. Re-renders.

### Promotion Modal

When a piece reaches the promotion zone:
1. Shows the modal with "Promote" / "Decline" options.
2. Waits for the player's decision.
3. Applies or rejects the promotion.

### Ambush Modal

When an archer activates the ambush with multiple victims:
1. Shows the modal with capture options.
2. Each option shows the victim piece and its location.
3. The player chooses which to capture.

### Game Saving

When a game ends (`finalizeHumanGame()`):
1. Collects all move data.
2. Compresses with pako (gzip).
3. Sends to `/api/saveGame`.
4. Saves the adaptive memory.

### AI vs AI Mode

1. `toggleAiVsAi()` activates the mode.
2. Both sides play automatically with `chooseBotMove()`.
3. All moves are recorded.
4. Upon finishing, saves the game and shows the result.

### Training Mode

1. `toggleTraining()` activates the mode.
2. Runs multiple AI vs AI games sequentially.
3. Learns from each game with `/api/learnFromGames`.
4. Shows progress statistics.

---

## 8.4 Board Editor (`src/ui/editor.js`)

### Functionality

The editor allows free modification of the board without rules:
- **Place pieces:** Select type and side, click on square.
- **Erase pieces:** Erase mode, click on piece to remove.
- **Promote:** Select piece on board, click "Promote".
- **Clear board:** Remove all pieces.
- **Reset:** Restore the initial layout.

### Editor Panel

Fixed floating panel on the right with:
- Side selector (Black/White).
- Piece palette (12 types with kanji).
- Action buttons: Place, Erase, Clear All, Reset, Promote, Close.
- Status bar showing the current action.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+E` | Open/close editor |

### Board Integration

The editor overrides the board click handler:
- In editor mode, clicks place/erase pieces.
- When closing the editor, normal gameplay behavior is restored.

---

## 8.5 Move Timeline (`src/ui/timeline.js`)

### Functionality

Allows navigating through the game history move by move:

### Snapshots

Each move generates a `snapshotForTimeline()` containing:
```javascript
{
  totalMoves: number,       // Move number
  notation: string[],       // Accumulated notation
  state: { ... },           // Complete state copy
}
```

### Rendering

`renderTimeline()` generates clickable buttons:
- **⏮ Start:** Goes back to the beginning.
- **1. Ke2:** Click to go to move 1.
- **2. pH5:** Click to go to move 2.
- The active button is highlighted.

### Navigation

`goToPly(ply)`:
1. Finds the corresponding snapshot.
2. Restores the complete state with `restoreFromTimelineSnapshot()`.
3. Updates `viewPly`.
4. Re-renders.
5. Scrolls to the active button.

### Game Loading

The timeline also handles loading saved games:
1. Reads the JSON file.
2. Resets the game.
3. Replays each move sequentially.
4. Generates snapshots for each ply.
5. Allows free navigation.

### Terminal Notation

At the end of the game, a suffix is appended:
| Status | Suffix | Meaning |
|--------|--------|---------|
| `checkmate` | `#` | Checkmate |
| `palacemate` | `##` | Palace mate |
| `stalemate` | `^` | Stalemate |
| `draw` | `=` | Draw |
| `draw_move_limit` | `/` | Draw by move limit |
| `draw_agreement` | `==` | Draw by agreement |

---

## 8.6 Styles (`styles.css`)

### Color Scheme

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#0a0e14` | Main background |
| `--surface` | `#0f141c` | Panel surface |
| `--border` | `#1a2033` | Borders |
| `--text` | `#c5d0e0` | Main text |
| `--muted` | `#3a4560` | Secondary text |
| `--accent` | `#8ab4ff` | Accents (selection) |
| `--white-piece` | `#65d38a` | White piece color |
| `--black-piece` | `#c084fc` | Black piece color |
| `--river` | `#112240` | River background |
| `--palace` | `#1a1530` | Palace background |

### Board

```css
#board {
  display: grid;
  grid-template-columns: repeat(13, 48px);
  grid-template-rows: repeat(13, 48px);
  gap: 1px;
  border: 2px solid var(--border);
  border-radius: 12px;
}
```

### Responsive

The design adapts to smaller screens by reducing cell size and reorganizing panels.
