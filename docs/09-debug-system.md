# 9. Debug System

The project includes a professional debug system with a browser panel, Node.js CLI, integrated profiling, and visual analysis tools.

---

## 9.1 Debug Module (`src/debug.js`)

### Features

- **Zero-cost when disabled:** All branches check `_active` before executing.
- **Persistent profiling:** Measures calls, total, avg, min, max per function.
- **Browser panel:** Per-module toggles, text search, level filter.
- **CLI integration:** Via `debug-cli.js` for terminal debugging.
- **JSON export:** Profiling data export.
- **Utilities:** `fn.assert()`, `perf.wrapAsync()`, sparkline helper.

### Debug Modules

| Module | Color | Description |
|--------|-------|-------------|
| `ai` | `#8ab4ff` | General AI engine |
| `rules` | `#65d38a` | Rules engine |
| `nn` | `#ff9f4a` | Neural network |
| `search` | `#c084fc` | Minimax search |
| `memory` | `#f9a8d4` | Adaptive memory |
| `selfplay` | `#34d399` | Self-play |
| `server` | `#fb923c` | Express server |
| `ui` | `#94a3b8` | User interface |
| `perf` | `#fbbf24` | Performance/profiling |
| `bot` | `#a78bfa` | Bot controller |
| `moves` | `#6ee7b7` | Move generation |

### Activation

Debug can be activated in multiple ways:

#### In Node.js (environment variable)

```bash
DEBUG=ai,search node src/server.js
DEBUG=all node src/server.js
```

#### In the Browser (URL)

```
http://localhost:3000?debug=ai,search
http://localhost:3000?debug=all
```

#### In the Browser (localStorage)

```javascript
localStorage.setItem('dbg', 'ai,search');
```

### Logger API

```javascript
import dbg from './debug.js';

const log = dbg('ai');

log('Evaluating position...');                     // Info
log.warn('Search cancelled by timeout');            // Warning
log.error('Evaluation error:', error);               // Error
log.assert(condition, 'Message if fails');            // Assertion

// Profiling
const timer = log.perf.start('search');
// ... code to measure ...
timer.end();

// Or wrap functions
const wrappedFn = log.perf.wrapAsync('botMove', async () => { ... });
```

### Browser Panel

Floating panel that shows:
- **Filters:** By module, level (info/warn/error), text search.
- **Log lines:** With timestamp, colored module, level, message.
- **Highlighting:** Text search highlights matches.
- **Statistics:** Counter of visible vs total lines.
- **Buffer:** Maximum 500 lines (FIFO).

### Profiling

```javascript
// Profiling data per label
_perfCounts[label]  // Number of calls
_perfTimes[label]   // Total accumulated time
_perfMin[label]     // Minimum time
_perfMax[label]     // Maximum time

// Average
avg = _perfTimes[label] / _perfCounts[label]
```

Exportable as JSON with `exportPerfData()`.

---

## 9.2 Debug CLI (`src/debug-cli.js`)

### Execution

```bash
npm run debug
# or directly
node src/debug-cli.js
```

### Features

Interactive CLI for analysis without a browser:

| Command | Description |
|---------|-------------|
| `eval` | Evaluates the current position |
| `moves [side]` | Lists legal moves |
| `perft [depth]` | Node count by depth |
| `search [depth]` | Executes bot search |
| `hash` | Shows the current Zobrist hash |
| `board` | Prints the board in ASCII |
| `memory` | Shows memory statistics |
| `set [r] [c] [type] [side]` | Places a piece |
| `clear` | Clears the board |
| `reset` | Resets the position |
| `help` | Command list |
| `exit` | Exit |

---

## 9.3 Development Tools (`src/tools/`)

Floating panel with 8 specialized tools, accessible via `Ctrl+Shift+T` or `?tools` in the URL.

### 9.3.1 Attack Overlay (`attack-overlay.js`)

Overlays attacked squares on the board:
- Colors by side (green for white, purple for black).
- Intensity proportional to the number of attackers.
- Toggle per side.

### 9.3.2 Search Tree Viewer (`search-tree.js`)

Minimax search tree visualizer:
- Shows expanded nodes with their score.
- Alpha-beta pruning highlighted.
- Adjustable depth.
- Principal Variation (PV) highlighted.

### 9.3.3 Eval Heatmap (`eval-heatmap.js`)

Per-square evaluation heatmap:
- Shows the positional bonus/penalty of each square.
- Color coding: red (negative) → green (positive).
- Real-time update when moving pieces.

### 9.3.4 Dataset Inspector (`dataset-inspector.js`)

Training data inspector for the neural network:
- Visualizes inputs (board encoding).
- Shows targets (normalized scores).
- Distribution statistics.

### 9.3.5 Benchmark Suite (`benchmark-suite.js`)

Performance benchmark suite:
- Measures evaluation time.
- Measures move generation time.
- Measures search time at different depths.
- Results in table format with average, min, max.

### 9.3.6 Perft Visual (`perft-visual.js`)

Move generation test (PERFormance Test):
- Counts nodes at each depth.
- Verifies move generator correctness.
- Distribution visualization by move type.

### 9.3.7 NN Inspector (`nn-inspector.js`)

Neural network inspector:
- Shows the current prediction for the position.
- Heuristic vs NN comparison.
- Encoded input visualization.

### 9.3.8 Replay Analyzer (`replay-analyzer.js`)

Saved game replay analyzer:
- Loads games from file.
- Evaluates each move with the evaluation function.
- Detects blunders, mistakes, brilliant moves.
- Evaluation graph throughout the game.

---

## 9.4 Keyboard Shortcuts

| Shortcut | Action | Module |
|----------|--------|--------|
| `Ctrl+Shift+E` | Open/close board editor | Editor |
| `Ctrl+Shift+T` | Open/close tools panel | Tools |
| `?debug=...` | Activate debug modules | URL param |
| `?tools` | Auto-open tools panel | URL param |
