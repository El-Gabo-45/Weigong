# 5. Motor de IA (`src/ai/`)

El motor de IA implementa un jugador automático basado en búsqueda Minimax con múltiples optimizaciones avanzadas. Está diseñado para jugar como el bando negro, aunque puede usarse para cualquier bando.

---

## 5.1 Módulos de IA

| Archivo | Responsabilidad |
|---------|----------------|
| `index.js` | Re-exporta la API pública de IA |
| `bot.js` | Controlador del bot: IDS + Aspiration Windows |
| `search.js` | Búsqueda Alpha-Beta con optimizaciones avanzadas |
| `evaluation.js` | Función de evaluación posicional completa |
| `hashing.js` | Zobrist hashing + Tabla de Transposición |
| `moves.js` | makeMove/unmakeMove eficiente + SEE (Static Exchange Evaluation) |
| `memory.js` | Memoria adaptativa: aprendizaje online de partidas |

---

## 5.2 Controlador del Bot (`bot.js`)

### `chooseBlackBotMove(state, options)`

Punto de entrada principal para que el bot elija un movimiento.

**Parámetros:**

| Opción | Default | Descripción |
|--------|---------|-------------|
| `maxDepth` | 8 | Profundidad máxima de búsqueda |
| `timeLimitMs` | 500 | Límite de tiempo en milisegundos |
| `aspirationWindow` | 45 | Ventana de aspiración inicial |

**Algoritmo:**

1. Obtiene un movimiento fallback (primer movimiento legal) por seguridad.
2. Inicializa la tabla de transposición (500K entradas) y calcula el hash Zobrist.
3. **Iterative Deepening Search (IDS):** Busca desde profundidad 1 hasta `maxDepth`:
   - Usa **Aspiration Windows** para acotar la ventana alpha-beta.
   - Si falla por debajo de alpha → re-busca con `alpha = -∞`.
   - Si falla por encima de beta → re-busca con `beta = +∞`.
   - Se detiene si encuentra mate o se agota el tiempo.
4. Retorna `{ move, score }`.

**Gestión de tiempo:**

```javascript
allocateTime(startTime, totalMs, movesLeft)
// Distribuye el tiempo disponible considerando los movimientos restantes
```

### Persistencia de Memoria

- `queueAdaptiveMemorySave()`: Guarda la memoria adaptativa en el servidor con debounce de 500ms.
- `loadAdaptiveMemory()`: Carga la memoria desde `/api/memory` al iniciar.
- `beforeunload`: Usa `navigator.sendBeacon` para guardar antes de cerrar la pestaña.

---

## 5.3 Búsqueda (`search.js`)

### Algoritmo Principal: Alpha-Beta con Optimizaciones

```
searchRoot(state, depth, alpha, beta, deadline, tt, hash, prevScore)
    │
    ├─ search(state, depth, alpha, beta, deadline, tt, hash, ...)  ← Recursiva
    │      │
    │      ├─ Detección de repetición (contempt = ±150)
    │      ├─ Consulta tabla de transposición (TT)
    │      ├─ Terminal check (mate/stalemate)
    │      ├─ Razoring (depth ≤ 2)
    │      ├─ Null Move Pruning (depth ≥ 3, R=2-3)
    │      ├─ ProbCut (depth ≥ 3)
    │      ├─ Ordenamiento de movimientos
    │      ├─ LMR (Late Move Reductions)
    │      ├─ Futility Pruning
    │      ├─ Multi-Cut (depth ≥ 3)
    │      └─ Almacenamiento en TT
    │
    └─ quiescence(state, alpha, beta, deadline, hash, staticEval)
           │
           └─ Solo movimientos tácticos (capturas + promociones)
               con SEE filtering
```

### Optimizaciones Implementadas

#### 5.3.1 Iterative Deepening Search (IDS)

Busca incrementalmente desde profundidad 1 hasta el máximo. Ventajas:
- Mejor ordenamiento de movimientos (usa resultados previos).
- Control granular del tiempo.
- Garantiza tener siempre un movimiento válido.

#### 5.3.2 Aspiration Windows

Acotan la ventana alpha-beta alrededor del score previo (±45). Si la búsqueda falla fuera de la ventana, se re-busca con ventana completa.

#### 5.3.3 Tabla de Transposición (TT)

Cachea posiciones evaluadas con su hash Zobrist:
- **EXACT:** Score exacto encontrado.
- **ALPHA:** Upper bound (no se mejoró alpha).
- **BETA:** Lower bound (causó cutoff).

Capacidad: 500,000 entradas con evicción LRU.

#### 5.3.4 Null Move Pruning

Si al pasar turno (sin mover) el oponente sigue perdiendo → podar esta rama.
- **Condiciones:** depth ≥ 3, no en jaque, sin drops disponibles, sin maldición de palacio.
- **Reducción R:** 3 para depth > 6, 2 para depth ≤ 6.

#### 5.3.5 Late Move Reductions (LMR)

Movimientos que se evalúan después en la lista (probablemente peores) se buscan con profundidad reducida:
- Se aplica a partir del movimiento #4.
- Reducción base: `log2(moveIndex) * log2(depth) * 0.4`.
- Si la búsqueda reducida mejora alpha → re-busca a profundidad completa.

#### 5.3.6 Futility Pruning

Si el score estático + un margen no puede mejorar alpha, se poda:
- Margen por profundidad: `[0, 150, 300, 500]`.

#### 5.3.7 Razoring

En profundidades bajas (≤ 2), si el score estático está muy por debajo de alpha (o por encima de beta), salta directamente a quiescence search.

#### 5.3.8 ProbCut

A profundidad ≥ 3, hace una búsqueda rápida a `depth - 4` con ventana estrecha. Si el resultado excede beta + margen → podar.

#### 5.3.9 Multi-Cut

A profundidad ≥ 3, si múltiples movimientos causan cutoff en búsqueda reducida → podar la rama completa.

#### 5.3.10 Quiescence Search

Extiende la búsqueda en posiciones tácticas (capturas, promociones, jaques):
- Filtrado SEE: Solo explora capturas rentables.
- Previene el efecto horizonte.

### Detección de Repetición en Búsqueda

```javascript
// 3ª repetición → empate con contempt
const DRAW_CONTEMPT = 150;
// Si el bot (negro) está ganando → el empate vale -150 (lo rechaza)
// Si está perdiendo → el empate vale +150 (lo busca)

// 2ª repetición → penalización de 600 en evaluación estática
// para que busque alternativas antes de la tercera
```

### Ordenamiento de Movimientos

Los movimientos se ordenan por score para maximizar podas:

| Prioridad | Criterio | Bonus |
|-----------|----------|-------|
| 1 | Movimiento de la TT | +1,000,000 |
| 2 | Captura de pieza valiosa con pieza barata | +valor capturado × 100 |
| 3 | Killer moves (movimientos que causaron cutoff en profundidades vecinas) | +900 / +650 |
| 4 | History heuristic (movimientos que históricamente causan cutoffs) | variable |
| 5 | Drops a casillas centrales | +50 |
| 6 | Penalización de memoria adaptativa | -variable |

---

## 5.4 Evaluación (`evaluation.js`)

### `evaluate(state, hash, precomputedMaps)`

Función de evaluación estática que retorna `{ score, metrics }`.

**Convención de score:** Positivo = ventaja para Negro, Negativo = ventaja para Blanco.

### Componentes de la Evaluación

#### 5.4.1 Material

Suma de valores de pieza (ver tabla en sección 4.1). Diferencia Negro - Blanco.

#### 5.4.2 Piece-Square Tables

Bonus posicional por ubicación de cada pieza:

| Pieza | Factores de Bonus |
|-------|------------------|
| Peón | Progreso × 12 + cruce de río + promoción |
| Caballo | Centralización (distancia al centro) |
| Cañón | Progreso × 4 |
| Torre | Progreso × 4 |
| Sacerdote | Base +16 |
| Arquero | +300 en orilla + progreso × 10 |
| Rey | +90 en palacio, -70 fuera del palacio |
| Reina | Base +35 |
| General | Base +18 |

#### 5.4.3 Piezas Colgantes (Hanging Penalty)

Si una pieza está atacada por el enemigo:
- Penalización base: `valor × 0.42 × número_de_atacantes`.
- Penalización extra si atacada por múltiples piezas.
- Penalización extra si la pieza no tiene movilidad (no puede huir).

#### 5.4.4 Peones Doblados

Penalización de 22 puntos por cada peón adicional en la misma columna.

#### 5.4.5 Presión de Palacio

- +50 por pieza propia en el palacio enemigo.
- +110 por pieza propia (si es blanco) en el palacio enemigo.
- Bonus progresivo para torres/reinas/cañones cerca del palacio enemigo.

#### 5.4.6 Control del Centro

Se calcula un mapa de ataques para cada bando y se puntúa:
- Casillas centrales (filas 4-8, columnas 4-8): +1 por ataque.
- Casillas del palacio enemigo: +5 por ataque.

#### 5.4.7 Ataques a Piezas Valiosas

Bonus si se ataca piezas enemigas de valor > 300.

#### 5.4.8 Valor de Reserva

Puntos por piezas en reserva (potencial de drop).

#### 5.4.9 Movilidad

`MOBILITY_WEIGHT = 9` puntos por cada movimiento legal disponible (diferencia entre bandos).

#### 5.4.10 Seguridad del Rey

Función `kingSafetyFast()`:
- Escudo del rey: bonus por piezas propias adyacentes al rey.
- Ataques al rey: penalización por piezas enemigas atacando zonas cercanas al rey.
- King escape routes: penalización si el rey tiene pocas casillas de escape.

#### 5.4.11 Estado del Palacio

- `palaceTaken`: ±350 puntos.
- `palaceCurse` activa: ±300 puntos base + 40 por turno adicional bajo maldición.

#### 5.4.12 Invasión Inminente del Palacio

Bonus por piezas a punto de invadir el palacio enemigo.

#### 5.4.13 Tempo

Bonus de 15 puntos por tener el turno.

#### 5.4.14 Penalización por Repetición

Penalización para desincentivar la repetición de posiciones.

#### 5.4.15 Memoria Adaptativa

Ajuste de evaluación basado en la experiencia acumulada de partidas anteriores (feature scores + pattern weights).

### Fase de Juego

```javascript
gamePhaseFactor(board)
// 0.0 = endgame (pocas piezas)
// 1.0 = apertura (muchas piezas)
// Se calcula por material total excluyendo peones y reyes
```

Algunos componentes de evaluación se escalan por fase: la seguridad del rey importa más en la apertura, el avance de peones importa más en el endgame.

### Build Attack Map

```javascript
buildAttackMap(board, side)
// Retorna: { attackMap, mobilityCount, byPiece, kingPos }
// attackMap: Map<"r,c" → count>  (cuántas piezas atacan cada casilla)
// mobilityCount: { total }       (total de movimientos posibles)
// byPiece: Map<"r,c" → count>    (movilidad de cada pieza individual)
// kingPos: { r, c }               (posición del rey)
```

---

## 5.5 Zobrist Hashing (`hashing.js`)

### Concepto

El hashing Zobrist genera un identificador de 64 bits único para cada posición del tablero. Permite:
- Detección de posiciones repetidas en O(1).
- Almacenamiento eficiente en la tabla de transposición.
- Actualización incremental (XOR al mover piezas).

### Tablas Zobrist

```javascript
ZobristTable[r][c][side][pieceType][promoted]  // Un hash por cada combinación
ZobristReserve[side][pieceType][count]          // Hash por reserva
ZobristTurn[0], ZobristTurn[1]                  // Hash del turno
ZobristPalaceWhite, ZobristPalaceBlack          // Hash de palacio tomado
```

### Operaciones

| Función | Descripción |
|---------|-------------|
| `computeFullHash(state)` | Calcula el hash completo de una posición desde cero |
| `xorPiece(hash, r, c, piece)` | Actualiza hash al agregar/quitar una pieza |
| `xorReserves(hash, reserves, sideIdx)` | Actualiza hash por cambios en reserva |

### Tabla de Transposición

```javascript
class TranspositionTable {
  constructor(maxSize = 500_000)
  get(key)      // Retorna entrada si existe (y actualiza age)
  set(key, val) // Almacena con evicción LRU al 10% cuando está llena
}
```

Cada entrada almacena:

```javascript
{
  score: number,        // Score de la posición
  depth: number,        // Profundidad a la que se evaluó
  flag: TT_EXACT|TT_ALPHA|TT_BETA,
  bestMoveKey: string,  // Mejor movimiento encontrado
  age: number,          // Para evicción LRU
}
```

---

## 5.6 Make/Unmake Move (`moves.js`)

### `makeMove(state, move, promote, currentHash, currentEval)`

Aplica un movimiento de forma eficiente para la búsqueda:

1. Guarda el estado de undo (celdas modificadas, turno, reservas, palacio, historial).
2. Calcula `evalDiff` incremental (diferencia de evaluación estimada sin recalcular todo).
3. Actualiza el hash Zobrist incrementalmente.
4. Llama a `applyMove()` del motor de reglas.
5. Retorna `{ action, undo, hash, evalDiff }`.

### `unmakeMove(state, { undo })`

Revierte un movimiento usando los datos de undo:
- Restaura las celdas del tablero.
- Restaura turno, reservas, palacio, historial.

### Static Exchange Evaluation (SEE)

```javascript
isSEEPositive(state, move, buildAttackMap)
// Evalúa si una captura es rentable considerando las recapturas
// Usado en quiescence para filtrar capturas perdedoras
```

### Valores de Piezas

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

## 5.7 Memoria Adaptativa (`memory.js`)

### Clase `AdaptiveMemory`

Sistema de aprendizaje online que mejora la evaluación con la experiencia:

#### Datos Almacenados

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `moveScores` | Map | Score acumulado por movimiento (clave: moveKey) |
| `featureScores` | Map | Score por feature key (estado posicional) |
| `blunderMoves` | Map | Movimientos que históricamente resultan en errores graves |
| `drawPositions` | Map | Posiciones que llevan a empates |
| `patternWeights` | Object | Pesos ajustables de patrones estratégicos |
| `gamesPlayed` | number | Total de partidas jugadas |
| `gamesWon` | number | Total de partidas ganadas |

#### Patrones Estratégicos (Pattern Weights)

```javascript
{
  centerControl: 1.0,    // Importancia del control del centro
  pieceActivity: 1.0,     // Importancia de la actividad de piezas
  kingSafety: 1.0,        // Importancia de la seguridad del rey
  materialBalance: 1.0,   // Importancia del balance de material
  pawnStructure: 1.0,     // Importancia de la estructura de peones
  palacePressure: 1.0,    // Importancia de la presión sobre el palacio
}
```

Se ajustan después de cada partida usando una tasa de aprendizaje de 0.12.

#### Feature Extraction

```javascript
extractFeatures(state, side)
// Genera una clave como: "ap:1|pp:2|r:0|er:1|pt:0|ept:0|cu:0|ecu:0"
// ap = archers on bank
// pp = palace pressure (0-3)
// r = reserve count
// er = enemy reserve count
// pt = palace taken
// ept = enemy palace taken
// cu = curse active
// ecu = enemy curse active
```

#### Umbrales de Error

```javascript
BLUNDER_THRESHOLD = 200  // Pérdida de evaluación > 200 = blunder
MISTAKE_THRESHOLD = 80   // Pérdida de evaluación > 80 = mistake
DECAY_RATE = 0.02        // Tasa de decaimiento de memoria
```

#### Poda de Memoria

- `moveScores`: Máximo 4,000 entradas (poda 20% más antiguas).
- `featureScores`: Máximo 3,000 entradas.
- `blunderMoves`: Máximo 2,000 entradas.
- `drawPositions`: Máximo 20,000 entradas.

#### Serialización

```javascript
toJSON()   // Convierte Maps a arrays de entries para JSON
fromJSON() // Reconstruye Maps desde arrays
```

---

## 5.8 Niveles de Dificultad

La UI ofrece 10 niveles de dificultad que ajustan los parámetros de búsqueda:

| Nivel | Nombre | Profundidad | Tiempo (ms) |
|-------|--------|-------------|-------------|
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
