# 2. Project Architecture

## 2.1 Directory Structure

```
Weigong/
├── index.html                  # Frontend entry point
├── styles.css                  # Global styles (board, UI, modals)
├── package.json                # Dependencies and npm scripts
├── package-lock.json           # Dependency lockfile
├── eslint.config.js            # ESLint 10 configuration
├── jest.config.cjs             # Jest 30 configuration
├── LICENSE                     # MIT License
├── README.md                   # Main project README
├── .gitignore                  # Ignores games/ and node_modules/
│
├── docs/                       # 📚 Technical documentation (this folder)
│
├── src/                        # 🧠 Main source code
│   ├── main.js                 # Frontend entry point (ES Module)
│   ├── state.js                # Global game state + DOM references
│   ├── constants.js            # Constants, enums, pure utilities
│   ├── server.js               # Express server (backend)
│   ├── debug.js                # Professional debug system
│   ├── debug-cli.js            # Node.js debug CLI
│   ├── nn-bridge.js            # Node.js ↔ C++/OpenCL Neural Network bridge
│   ├── selfplay.js             # Self-play engine for training
│   ├── selfplay-worker.js      # Worker thread for parallel self-play
│   │
│   ├── rules/                  # ♟ Game rules engine
│   │   ├── index.js            # Re-exports all public rules API
│   │   ├── core.js             # Core engine: applyMove, getAllLegalMoves
│   │   ├── board.js            # Board utilities: layout, cloning, hashing
│   │   ├── moves.js            # Pseudo-legal and legal move generation
│   │   ├── check.js            # Check detection, attacked squares
│   │   ├── state.js            # Palace state: curse, timers, invaders
│   │   ├── archer.js           # Archer special mechanic (ambush)
│   │   └── game.js             # Game state factory (createGame, resetGame)
│   │
│   ├── ai/                     # 🤖 Artificial intelligence engine
│   │   ├── index.js            # Re-exports all public AI API
│   │   ├── bot.js              # Bot controller: IDS + aspiration windows
│   │   ├── search.js           # Minimax search with Alpha-Beta + optimizations
│   │   ├── evaluation.js       # Positional evaluation function
│   │   ├── hashing.js          # Zobrist hashing + Transposition Table
│   │   ├── moves.js            # Efficient makeMove/unmakeMove + SEE
│   │   └── memory.js           # Adaptive memory (online learning)
│   │
│   ├── ui/                     # 🎨 User interface
│   │   ├── gameplay.js         # Board rendering + main interaction
│   │   ├── editor.js           # Free board editor
│   │   └── timeline.js         # Move timeline + ply navigation
│   │
│   ├── tools/                  # 🛠 Development tools (browser)
│   │   ├── tools-panel.js      # Floating panel with tabs
│   │   ├── attack-overlay.js   # Attacked squares overlay
│   │   ├── search-tree.js      # Search tree visualizer
│   │   ├── eval-heatmap.js     # Evaluation heatmap
│   │   ├── dataset-inspector.js# Training dataset inspector
│   │   ├── benchmark-suite.js  # Performance benchmark suite
│   │   ├── perft-visual.js     # Visual perft (node counting)
│   │   ├── nn-inspector.js     # Neural network inspector
│   │   └── replay-analyzer.js  # Replay analyzer
│   │
│   └── data/
│       └── ai-memory.json      # Persistent adaptive memory data
│
├── neural_network_gpu/         # 🧪 C++/OpenCL neural network
│   ├── Makefile                # Build script for nn_train binary
│   ├── model.bin               # Pre-trained model (binary)
│   ├── nn_kernel.cl            # OpenCL kernels
│   ├── src/
│   │   ├── main.cpp            # Training entry point
│   │   ├── nn.cpp              # Neural network implementation
│   │   ├── nn.h                # Neural network definitions
│   │   ├── train.cpp           # Training logic
│   │   └── nn_kernel.cl        # OpenCL kernels (source)
│   └── build/
│       ├── nn.o                # Compiled object
│       └── train.o             # Compiled object
│
├── games/                      # 📂 Saved games (gitignored)
│   └── .gitkeep
│
└── tests/                      # 🧪 Unit tests (Jest)
    ├── board.test.js           # Board tests
    ├── check.test.js           # Check tests
    ├── core.test.js            # Core engine tests
    ├── debug.test.js           # Debug system tests
    ├── evaluation.test.js      # Evaluation tests
    ├── hashing.test.js         # Zobrist hashing tests
    ├── moves.test.js           # Move generation tests
    └── utils.test.js           # Utility tests
```

---

## 2.2 Dependencies

### Production (`dependencies`)

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^5.2.1 | HTTP server for serving frontend and REST API |
| `node-fetch` | ^3.3.2 | HTTP client for inter-component communication |
| `pako` | ^2.1.0 | Gzip compression/decompression for game saving |

### Development (`devDependencies`)

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | ^10.3.0 | JavaScript linter |
| `@eslint/js` | ^10.0.1 | ESLint base configuration |
| `eslint-config-prettier` | ^10.1.8 | Disables ESLint rules that conflict with Prettier |
| `globals` | ^17.6.0 | Global variables for ESLint (browser + node) |
| `jest` | ^30.4.2 | Testing framework |
| `prettier` | ^3.8.3 | Code formatter |

---

## 2.3 Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│                                                          │
│  index.html ──→ main.js ──→ state.js (global state)     │
│                    │                                     │
│                    ├──→ ui/gameplay.js (render + input)   │
│                    ├──→ ui/editor.js (free editor)        │
│                    ├──→ ui/timeline.js (history)          │
│                    └──→ tools/tools-panel.js (dev)        │
│                                                          │
│  The frontend uses ES Modules directly in the browser.   │
│  pako is imported via importmap from CDN.                │
└────────────────────────┬────────────────────────────────-┘
                         │ HTTP (fetch)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      BACKEND                             │
│                                                          │
│  server.js (Express 5)                                   │
│    │                                                     │
│    ├── /api/memory      → ai-memory.json (read/write)    │
│    ├── /api/saveGame    → games/*.json (save game)        │
│    ├── /api/learnFromGames → processes games/ → memory   │
│    ├── /api/memoryStats → memory statistics               │
│    ├── /api/bot         → chooseBlackBotMove()           │
│    ├── /api/evaluate    → evaluate() a position          │
│    ├── /api/nn/*        → neural network (train/predict) │
│    ├── /api/selfplay    → starts automatic games         │
│    └── static files     → serves index.html, src/, etc.  │
│                                                          │
│  The server also uses Worker Threads for self-play.      │
└────────────────────────┬────────────────────────────────-┘
                         │ spawn (child process)
                         ▼
┌─────────────────────────────────────────────────────────┐
│              NEURAL NETWORK (C++/OpenCL)                 │
│                                                          │
│  nn_train (compiled binary)                              │
│    Receives JSON via stdin → Trains/Predicts             │
│    Output: loss, predictions, model info                 │
│                                                          │
│  Architecture: input → 512 → 256 → 128 → 64 → 1        │
│  Loss: Huber | Optimizer: AdamW | Activation: LeakyReLU  │
└─────────────────────────────────────────────────────────┘
```

---

## 2.4 Module Type

The project uses **ES Modules** (`"type": "module"` in `package.json`):

- All `import`/`export` uses ESM syntax.
- Frontend files are loaded directly by the browser with `<script type="module">`.
- The backend (Node.js) also uses ESM.
- The exception is `jest.config.cjs` which uses CommonJS (required by Jest).

---

## 2.5 Import Map (Frontend)

`index.html` defines an `importmap` to resolve `pako` from CDN:

```html
<script type="importmap">
{
  "imports": {
    "pako": "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.esm.mjs"
  }
}
</script>
```

This allows frontend modules to do `import pako from 'pako'` without a bundler.
