# 10. Development Guide

Guide for setting up the development environment, running tests, and contributing to the project.

---

## 10.1 Requirements

### Required Software

| Software | Minimum Version | Usage |
|----------|----------------|-------|
| Node.js | 18+ | Server, tests, tooling |
| npm | 9+ | Dependency management |
| Git | 2.30+ | Version control |
| Modern browser | Chrome/Firefox/Edge | Frontend (ES Modules) |

### Optional (for GPU neural network)

| Software | Version | Usage |
|----------|---------|-------|
| C++ compiler | C++17 | Compile nn_train |
| OpenCL SDK | 1.2+ | GPU acceleration |
| Compatible GPU | OpenCL 1.2+ | NN training |

---

## 10.2 Installation

```bash
# Clone the repository
git clone https://github.com/El-Gabo-45/Weigong.git
cd Weigong

# Install dependencies
npm install
```

---

## 10.3 npm Scripts

### Production and Development

| Script | Command | Description |
|--------|---------|-------------|
| `npm start` | `node src/server.js` | Server in production mode (port 3000) |
| `npm run dev` | `DEBUG=server,nn,selfplay node src/server.js` | Server, NN, and self-play debug |
| `npm run dev:ai` | `DEBUG=ai,search,memory,perf node src/server.js` | AI-focused debug |
| `npm run dev:all` | `DEBUG=all node src/server.js` | All debug modules enabled |

### Testing

| Script | Command | Description |
|--------|---------|-------------|
| `npm test` | `node --experimental-vm-modules node_modules/.bin/jest --verbose` | Runs all tests |

### Code Quality

| Script | Command | Description |
|--------|---------|-------------|
| `npm run lint` | `eslint src/ tests/` | Checks code style |
| `npm run format` | `prettier --write .` | Formats all code |

### Debug CLI

| Script | Command | Description |
|--------|---------|-------------|
| `npm run debug` | `node src/debug-cli.js` | Interactive debug CLI |

---

## 10.4 Testing

### Framework: Jest 30

Tests located in `tests/`:

| File | Coverage |
|------|----------|
| `board.test.js` | Initial layout, state cloning, hashing |
| `check.test.js` | Check detection, attacked squares |
| `core.test.js` | applyMove, drops, promotion, end of game |
| `debug.test.js` | Debug system, profiling |
| `evaluation.test.js` | Evaluation function, components |
| `hashing.test.js` | Zobrist hashing, transposition table |
| `moves.test.js` | Per-piece move generation |
| `utils.test.js` | Utility functions |

### Execution

```bash
# All tests
npm test

# Specific test
npx jest tests/moves.test.js --verbose

# With coverage
npx jest --coverage
```

### Jest Configuration (`jest.config.cjs`)

```javascript
module.exports = {
  transform: {},
  testEnvironment: 'node',
};
```

Note: Jest runs with `--experimental-vm-modules` for ES Modules support.

---

## 10.5 Linting and Formatting

### ESLint (`eslint.config.js`)

Flat configuration (ESLint 10):
- Base: `@eslint/js` recommended.
- Globals: `browser` + `node`.
- Files: `**/*.{js,mjs,cjs}`.

```bash
# Check
npm run lint

# Auto-fix
npx eslint src/ tests/ --fix
```

### Prettier

```bash
# Format everything
npm run format

# Check without changing
npx prettier --check .
```

---

## 10.6 Development Server

### Option 1: Node.js (recommended)

```bash
npm start           # Port 3000
# or
npm run dev         # Port 3000 + debug
```

Open `http://localhost:3000` in the browser.

### Option 2: Python static server

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Only serves static files (no bot API, no game saving).

---

## 10.7 Code Structure

### Conventions

- **ES Modules:** All `import`/`export` uses ESM syntax.
- **No bundler:** Modules are loaded directly in the browser.
- **Bilingual:** Comments in Spanish and English.
- **Constants:** Defined in `constants.js`, imported where needed.
- **Global state:** Centralized in `state.js`.
- **Pure UI:** No frameworks (vanilla JS + DOM manipulation).

### Common Patterns

#### Module Imports

```javascript
// Game rules
import { createGame, applyMove, getAllLegalMoves } from './rules/index.js';

// AI
import { chooseBlackBotMove, evaluate, computeFullHash } from './ai/index.js';

// Constants
import { SIDE, BOARD_SIZE, PIECE_DATA, isPalaceSquare } from './constants.js';
```

#### Creating a Piece

```javascript
import { makePiece } from './rules/board.js';
const tower = makePiece('tower', 'white');
// { id: "uuid", type: "tower", side: "white", promoted: false, locked: false }
```

#### Evaluating a Position

```javascript
import { evaluate, computeFullHash } from './ai/index.js';
const hash = computeFullHash(state);
const { score, metrics } = evaluate(state, hash);
// score > 0 → advantage for Black
// score < 0 → advantage for White
```

#### Getting Legal Moves

```javascript
import { getAllLegalMoves } from './rules/index.js';
const moves = getAllLegalMoves(state, state.turn);
// [{ from: {r,c}, to: {r,c} }, { fromReserve: true, reserveIndex, to }, ...]
```

---

## 10.8 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express server port |
| `DEBUG` | (empty) | Debug modules: `ai,search,memory,perf,nn,selfplay,server,ui,bot,moves,rules,all` |

---

## 10.9 Neural Network (Compilation)

If an OpenCL-compatible GPU is available:

```bash
cd neural_network_gpu
make nn_train nn_gpu
```

Generates the `nn_train` binary that the server uses for training and inference.

Without a GPU, the server functions normally using only the heuristic evaluation.

---

## 10.10 Workflow

### Adding a New Piece

1. Add entry in `PIECE_DATA` (`src/constants.js`).
2. Implement movement in `pseudoMovesForPiece()` (`src/rules/moves.js`).
3. Add value in `PIECE_VALUES` (`src/ai/moves.js`).
4. Update `PIECE_CHANNEL` in `src/selfplay.js`.
5. Add notation in `getPieceSymbol()` (`src/ui/gameplay.js`).
6. Update initial layout in `initialLayout()` (`src/rules/board.js`).
7. Add tests in `tests/moves.test.js`.

### Modifying the Evaluation

1. Edit `evaluate()` in `src/ai/evaluation.js`.
2. Components are added/subtracted to the total score.
3. Positive = Black advantage, Negative = White advantage.
4. Run tests: `npx jest tests/evaluation.test.js`.

### Adding an API Endpoint

1. Add route in `src/server.js`.
2. Follow the existing pattern (try/catch, JSON response).
3. If it uses game state, import from `./rules/index.js`.
