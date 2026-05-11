# 7. Server & API (`src/server.js`)

The Express server handles communication between the frontend, AI, and neural network. It serves static files and exposes a complete REST API.

---

## 7.1 Configuration

```javascript
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..')));  // Serves the frontend
```

- **Port:** 3000 by default (configurable with `PORT` environment variable).
- **Body limit:** 50MB (for large training data).
- **Static files:** Serves the entire project root directory.

---

## 7.2 API Endpoints

### 7.2.1 Adaptive Memory

#### `GET /api/memory`

Returns the current content of the adaptive memory (`ai-memory.json`).

**Response:** JSON with `moveScores`, `featureScores`, `blunderMoves`, `drawPositions`, `patternWeights`, `gamesPlayed`, `gamesWon`.

#### `POST /api/memory`

Saves the complete adaptive memory.

**Body:** Complete memory JSON object.
**Response:** `{ ok: true }`

#### `GET /api/memoryStats`

Adaptive memory statistics.

**Response:**
```json
{
  "gamesPlayed": 42,
  "gamesWon": 18,
  "winRate": "42.9%",
  "moveMemory": 1500,
  "featureMemory": 800,
  "blunders": 200,
  "drawMemory": 5000,
  "pendingGames": 3,
  "patternWeights": { ... }
}
```

---

### 7.2.2 Games

#### `POST /api/saveGame`

Saves a finished game. Accepts direct JSON or gzip-compressed data (pako).

**Body:**
```json
{
  "moves": [...],         // Array of moves with metadata
  "finalStatus": "checkmate",
  "startedAt": "...",
  "duration": 12345
}
```

**Response:** `{ ok: true, file: "game_1234567890_abc123.json" }`

Games are saved in `games/` with a unique name based on timestamp and random hash.

#### `POST /api/learnFromGames`

Processes all unprocessed saved games and updates the adaptive memory:

1. Reads all `.json` files in `games/` that don't contain "processed" in the name.
2. For each game:
   - Determines the result (win/loss/draw).
   - Updates `moveScores` with evaluation deltas.
   - Records blunders and mistakes.
   - Updates `featureScores` with the result.
   - For draws: records positions in `drawPositions`.
3. Adjusts `patternWeights` based on metrics.
4. Renames processed files to `.processed.json`.
5. Saves the updated memory.

**Response:** `{ ok: true, learned: 5, gamesPlayed: 47 }`

---

### 7.2.3 Bot

#### `POST /api/bot`

Requests a bot move for a given position.

**Body:**
```json
{
  "state": { ... },       // Complete game state
  "maxDepth": 8,          // Maximum depth (optional)
  "timeLimitMs": 500      // Time limit (optional)
}
```

**Response:**
```json
{
  "move": {
    "from": { "r": 2, "c": 6 },
    "to": { "r": 4, "c": 6 },
    "promotion": false
  },
  "score": 45
}
```

---

### 7.2.4 Evaluation

#### `POST /api/evaluate`

Evaluates a board position.

**Body:**
```json
{
  "state": { ... }  // Game state to evaluate
}
```

**Response:**
```json
{
  "score": 127,
  "metrics": {
    "palacePressure": 0.6,
    "pieceActivity": 0.55,
    "materialBalance": 0.52,
    "kingSafety": 0.48,
    "centerControl": 0.51
  }
}
```

---

### 7.2.5 Neural Network

#### `GET /api/nn/info`

Neural network model information.

**Response:** Architecture, model size, training status.

#### `POST /api/nn/train`

Starts neural network training with saved games.

**Body:**
```json
{
  "epochs": 10,
  "batchSize": 64
}
```

**Response:** Training progress, loss per epoch.

#### `POST /api/nn/predict`

Score prediction for a position.

**Body:** Input vector (serialized Float32Array).
**Response:** Predicted score [-1, 1].

---

### 7.2.6 Self-Play

#### `POST /api/selfplay`

Starts self-play games (AI vs AI) to generate training data.

**Body:**
```json
{
  "games": 10,           // Number of games to play
  "maxMoves": 200,       // Maximum moves per game
  "saveGames": true      // Save games to disk
}
```

Self-play uses Worker Threads to avoid blocking the main server.

#### `GET /api/selfplay/status`

Current self-play status (in progress, completed, etc.).

---

### 7.2.7 Export

#### `POST /api/export`

Exports the current game state in compressed JSON format.

---

## 7.3 Data Files

### `src/data/ai-memory.json`

Persistent storage for adaptive memory. Created automatically if it doesn't exist with default values.

### `games/*.json`

Saved games. Processed with `/api/learnFromGames` and renamed to `.processed.json`.

---

## 7.4 Self-Play (`src/selfplay.js`)

### Self-Play Engine

The self-play module runs complete games between two bot instances:

1. **Initialization:** Creates a fresh game state.
2. **Game loop:** Each turn:
   - Computes the bot's move (`chooseBotMove`).
   - Decides promotion (if possible and strategically advantageous).
   - Applies the move.
   - Handles archer ambushes (chooses automatically).
   - Records data for NN training (board encoding).
   - Evaluates end-game condition.
3. **Finalization:** Saves the game with all metadata.

### Neural Network Encoding

```javascript
function encodeBoardForNN(board) {
  const enc = new Float32Array(13 * 13 * 24);  // 4056 elements
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const p = board[r][c];
      if (!p) continue;
      const ch = PIECE_CHANNEL[p.type];      // 0-11
      const offset = p.side === 'white' ? 0 : 12;
      enc[(r * 13 + c) * 24 + offset + ch] = 1.0;
    }
  }
  return enc;
}
```

### Worker Thread (`src/selfplay-worker.js`)

Runs self-play in a separate thread to avoid blocking the server's event loop.

---

## 7.5 Related npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `node src/server.js` | Starts the server in production mode |
| `dev` | `DEBUG=server,nn,selfplay node src/server.js` | Server with server/nn/selfplay debug |
| `dev:ai` | `DEBUG=ai,search,memory,perf node src/server.js` | Server with AI-focused debug |
| `dev:all` | `DEBUG=all node src/server.js` | Server with all debug enabled |

---

## 7.6 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `DEBUG` | (none) | Debug modules to enable (comma-separated) |
