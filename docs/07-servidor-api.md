# 7. Servidor y API (`src/server.js`)

El servidor Express maneja la comunicación entre el frontend, la IA, y la red neuronal. Sirve archivos estáticos y expone una API REST completa.

---

## 7.1 Configuración

```javascript
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..')));  // Sirve el frontend
```

- **Puerto:** 3000 por defecto (configurable con variable de entorno `PORT`).
- **Límite de body:** 50MB (para datos de entrenamiento grandes).
- **Static files:** Sirve todo el directorio raíz del proyecto.

---

## 7.2 Endpoints de la API

### 7.2.1 Memoria Adaptativa

#### `GET /api/memory`

Retorna el contenido actual de la memoria adaptativa (`ai-memory.json`).

**Response:** JSON con `moveScores`, `featureScores`, `blunderMoves`, `drawPositions`, `patternWeights`, `gamesPlayed`, `gamesWon`.

#### `POST /api/memory`

Guarda la memoria adaptativa completa.

**Body:** Objeto JSON completo de la memoria.
**Response:** `{ ok: true }`

#### `GET /api/memoryStats`

Estadísticas de la memoria adaptativa.

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

### 7.2.2 Partidas

#### `POST /api/saveGame`

Guarda una partida finalizada. Acepta JSON directo o datos comprimidos con gzip (pako).

**Body:**
```json
{
  "moves": [...],         // Array de movimientos con metadata
  "finalStatus": "checkmate",
  "startedAt": "...",
  "duration": 12345
}
```

**Response:** `{ ok: true, file: "game_1234567890_abc123.json" }`

Las partidas se guardan en `games/` con nombre único basado en timestamp y hash aleatorio.

#### `POST /api/learnFromGames`

Procesa todas las partidas guardadas no procesadas y actualiza la memoria adaptativa:

1. Lee todos los archivos `.json` en `games/` que no contengan "processed" en el nombre.
2. Para cada partida:
   - Determina el resultado (win/loss/draw).
   - Actualiza `moveScores` con los deltas de evaluación.
   - Registra blunders y mistakes.
   - Actualiza `featureScores` con el resultado.
   - Para empates: registra posiciones en `drawPositions`.
3. Ajusta `patternWeights` basándose en las métricas.
4. Renombra los archivos procesados a `.processed.json`.
5. Guarda la memoria actualizada.

**Response:** `{ ok: true, learned: 5, gamesPlayed: 47 }`

---

### 7.2.3 Bot

#### `POST /api/bot`

Solicita un movimiento del bot para una posición dada.

**Body:**
```json
{
  "state": { ... },       // Estado completo del juego
  "maxDepth": 8,          // Profundidad máxima (opcional)
  "timeLimitMs": 500      // Límite de tiempo (opcional)
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

### 7.2.4 Evaluación

#### `POST /api/evaluate`

Evalúa una posición del tablero.

**Body:**
```json
{
  "state": { ... }  // Estado del juego a evaluar
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

### 7.2.5 Red Neuronal

#### `GET /api/nn/info`

Información del modelo de red neuronal.

**Response:** Arquitectura, tamaño del modelo, estado de entrenamiento.

#### `POST /api/nn/train`

Inicia el entrenamiento de la red neuronal con las partidas guardadas.

**Body:**
```json
{
  "epochs": 10,
  "batchSize": 64
}
```

**Response:** Progreso del entrenamiento, loss por época.

#### `POST /api/nn/predict`

Predicción de score para una posición.

**Body:** Vector de entrada (Float32Array serializado).
**Response:** Score predicho [-1, 1].

---

### 7.2.6 Self-Play

#### `POST /api/selfplay`

Inicia partidas de auto-juego (IA vs IA) para generar datos de entrenamiento.

**Body:**
```json
{
  "games": 10,           // Número de partidas a jugar
  "maxMoves": 200,       // Máximo de movimientos por partida
  "saveGames": true      // Guardar partidas en disco
}
```

El self-play usa Worker Threads para no bloquear el servidor principal.

#### `GET /api/selfplay/status`

Estado actual del self-play (en progreso, completado, etc.).

---

### 7.2.7 Exportación

#### `POST /api/export`

Exporta el estado actual del juego en formato JSON comprimido.

---

## 7.3 Archivos de Datos

### `src/data/ai-memory.json`

Almacenamiento persistente de la memoria adaptativa. Se crea automáticamente si no existe con valores por defecto.

### `games/*.json`

Partidas guardadas. Se procesan con `/api/learnFromGames` y se renombran a `.processed.json`.

---

## 7.4 Self-Play (`src/selfplay.js`)

### Motor de Auto-Juego

El módulo de self-play ejecuta partidas completas entre dos instancias del bot:

1. **Inicialización:** Crea un estado de juego fresco.
2. **Bucle de juego:** En cada turno:
   - Calcula el movimiento del bot (`chooseBotMove`).
   - Decide promoción (si es posible y estratégicamente ventajosa).
   - Aplica el movimiento.
   - Maneja emboscadas del arquero (elige automáticamente).
   - Registra datos para entrenamiento NN (codificación del tablero).
   - Evalúa condición de fin de juego.
3. **Finalización:** Guarda la partida con todos los metadatos.

### Codificación para Red Neuronal

```javascript
function encodeBoardForNN(board) {
  const enc = new Float32Array(13 * 13 * 24);  // 4056 elementos
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

Ejecuta el self-play en un thread separado para no bloquear el event loop del servidor.

---

## 7.5 Scripts npm Relacionados

| Script | Comando | Descripción |
|--------|---------|-------------|
| `start` | `node src/server.js` | Inicia el servidor en modo producción |
| `dev` | `DEBUG=server,nn,selfplay node src/server.js` | Servidor con debug de server/nn/selfplay |
| `dev:ai` | `DEBUG=ai,search,memory,perf node src/server.js` | Servidor con debug de IA |
| `dev:all` | `DEBUG=all node src/server.js` | Servidor con todo el debug habilitado |

---

## 7.6 Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | 3000 | Puerto del servidor |
| `DEBUG` | (ninguno) | Módulos de debug a habilitar (separados por coma) |
