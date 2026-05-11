# 3. Motor de Reglas (`src/rules/`)

El motor de reglas es el corazón lógico del juego. Maneja la generación de movimientos, validación de legalidad, detección de jaque/mate, y todas las mecánicas especiales del juego.

---

## 3.1 Módulos del Motor

| Archivo | Responsabilidad |
|---------|----------------|
| `index.js` | Re-exporta la API pública del motor de reglas |
| `core.js` | Motor central: `applyMove`, `getAllLegalMoves`, drops, evaluación post-movimiento |
| `board.js` | Utilidades del tablero: layout inicial, clonado, hashing de posición |
| `moves.js` | Generación de movimientos pseudo-legales y legales por pieza |
| `check.js` | Detección de jaque, casillas atacadas, cuadrados de ataque |
| `state.js` | Estado del palacio: maldición, temporizadores, invasores |
| `archer.js` | Mecánica especial del arquero: emboscada, casillas bloqueadas |
| `game.js` | Fábrica del estado de juego: `createGame()`, `resetGame()` |

---

## 3.2 Estado del Juego (`game.js`)

La función `createGame()` retorna el estado completo del juego:

```javascript
{
  board: Array[13][13],         // Tablero 13x13 (null = vacío, objeto = pieza)
  turn: "white" | "black",     // Turno actual
  selected: null,               // Pieza seleccionada por el jugador
  legalMoves: [],               // Movimientos legales calculados
  reserves: {
    white: [],                  // Piezas capturadas reutilizables para blanco
    black: [],                  // Piezas capturadas reutilizables para negro
  },
  promotionRequest: null,       // Solicitud de promoción pendiente
  status: "playing",            // Estado: playing|checkmate|stalemate|palacemate|draw
  message: "Partida lista.",    // Mensaje de estado para la UI
  palaceTimers: {               // Temporizadores de asedio del palacio
    white: { pressure: 0, invaded: false, attackerSide: null },
    black: { pressure: 0, invaded: false, attackerSide: null },
  },
  palaceTaken: { white: false, black: false },  // ¿Palacio tomado?
  palaceCurse: {                // Maldición del palacio
    white: { active: false, turnsInPalace: 0 },
    black: { active: false, turnsInPalace: 0 },
  },
  lastMove: null,               // Último movimiento realizado
  lastRepeatedMoveKey: null,    // Clave del último movimiento repetido
  repeatMoveCount: 0,           // Contador de repeticiones consecutivas
  positionHistory: Map,         // Historial de posiciones para detección de repetición
}
```

### Estructura de una Pieza

```javascript
{
  id: "uuid-v4",      // Identificador único (crypto.randomUUID())
  type: "king",        // Tipo: king|queen|general|elephant|priest|horse|cannon|tower|carriage|archer|pawn|crossbow
  side: "white",       // Bando: white|black
  promoted: false,     // ¿Está promocionada?
  locked: false,       // ¿Está bloqueada? (uso interno)
}
```

---

## 3.3 Generación de Movimientos (`moves.js`)

### Pipeline de Movimientos

```
pseudoMovesForPiece()      ← Genera todos los movimientos posibles sin verificar legalidad
       │
       ▼
getLegalMovesForSquare()   ← Filtra pseudo-movimientos:
       │                      1. Restricciones de tipo (archer/carriage en propio lado)
       │                      2. No terminar en el río
       │                      3. No capturar piezas propias
       │                      4. No moverse a casillas protegidas por arquero enemigo
       │                      5. Verificación de jaque propio (simulate + check)
       ▼
  Movimientos legales finales
```

### Función `pseudoMovesForPiece(board, piece, r, c, state)`

Genera movimientos pseudo-legales según el tipo de pieza. Cada movimiento retorna:

```javascript
{
  r: number,           // Fila destino
  c: number,           // Columna destino
  capture: boolean,    // ¿Es una captura?
  special: string|null // Movimiento especial (opcional)
}
```

### Función `getLegalMovesForSquare(state, r, c)`

1. Obtiene pseudo-movimientos de `pseudoMovesForPiece`.
2. Filtra las restricciones de movimiento:
   - Arqueros y carruajes solo pueden moverse en su propio lado.
   - Ninguna pieza puede terminar en la fila del río.
   - No se puede mover a casillas protegidas por arquero enemigo.
3. Simula cada movimiento y verifica que el rey propio no quede en jaque.
4. Retorna solo los movimientos legales.

### Utilidades de Movimiento

| Función | Descripción |
|---------|-------------|
| `rayMoves(board, piece, r, c, dirs, maxSteps)` | Genera movimientos en línea recta (torre, reina, sacerdote). Se detiene al encontrar pieza. |
| `jumpMoves(board, piece, r, c, deltas)` | Genera saltos a posiciones fijas (caballo-like). |
| `addIfValid(moves, board, piece, fromR, fromC, toR, toC)` | Agrega movimiento si está en bounds y no captura pieza propia. |

---

## 3.4 Motor Central (`core.js`)

### `applyMove(state, action)`

Aplica un movimiento al estado del juego. Maneja:

1. **Drops desde reserva:** Retira pieza de reserva y la coloca en el tablero.
2. **Movimientos normales:** Mueve pieza de origen a destino. Si hay captura:
   - Pieza capturada reutilizable → va a la reserva del captor.
   - Pieza no reutilizable → eliminada.
3. **Promoción:** Si la pieza llega a zona de promoción y el jugador elige promover.
4. **Actualización de palacio:** Llama a `updatePalaceState()`.
5. **Cambio de turno:** `state.turn = opponent(state.turn)`.
6. **Emboscada del arquero:** Si un arquero llega a la orilla, verifica víctimas.
7. **Historial de posiciones:** Registra la firma de posición para detección de repetición.

### `getAllLegalMoves(state, side)`

Genera **todos** los movimientos legales para un bando:

1. Itera sobre todas las piezas del bando en el tablero → `getLegalMovesForSquare()`.
2. Agrega drops legales de reserva → `getLegalReserveDrops()`.
3. Retorna lista de `{ from: {r,c}, to: {r,c} }` y drops `{ fromReserve: true, reserveIndex, to }`.

### `getLegalReserveDrops(state, side)`

Genera drops legales desde la reserva:

1. Para cada pieza en reserva, itera sobre todas las casillas vacías.
2. Verifica: casilla vacía, no río, lado correcto, no protegida por arquero enemigo.
3. Simula el drop y verifica que el rey propio no quede en jaque.

### `afterMoveEvaluation(state)`

Evaluación post-movimiento que detecta condiciones de fin de juego:

1. **Triple repetición:** Si la posición actual ha ocurrido 3 veces → empate.
2. **Sin movimientos legales:**
   - En jaque → **jaque mate** (pierde el jugador activo).
   - Sin jaque → **ahogado** (empate).
3. **Mate de palacio:** Si el rey está atrapado en su palacio con enemigos dentro y sin escape ni posibilidad de expulsarlos.
4. **Palacio tomado:** Si un palacio ha estado bajo asedio suficiente tiempo.

---

## 3.5 Detección de Jaque (`check.js`)

### `isKingInCheck(state, side)`

Verifica si el rey del bando dado está en jaque:

1. Localiza el rey en el tablero con `findKings()`.
2. Llama a `isSquareAttacked(board, king.r, king.c, opponent(side), state)`.
3. Retorna `true` si la casilla del rey está atacada.

### `isSquareAttacked(board, r, c, bySide, state)`

Verifica si una casilla está atacada por alguna pieza del bando `bySide`:

1. Para cada pieza del bando atacante, genera sus cuadrados de ataque con `attackSquaresForPiece()`.
2. Si algún cuadrado de ataque coincide con `(r, c)` → casilla atacada.
3. **Caso especial:** Confrontación de reyes en la misma columna sin piezas intermedias (regla heredada del Xiangqi).

### `attackSquaresForPiece(board, piece, r, c, state)`

Genera los cuadrados que una pieza ataca (no necesariamente donde puede moverse legalmente). Es similar a `pseudoMovesForPiece` pero se usa específicamente para detección de amenazas.

---

## 3.6 Tablero (`board.js`)

### Funciones del Tablero

| Función | Descripción |
|---------|-------------|
| `makePiece(type, side, promoted)` | Crea un objeto pieza con UUID único |
| `initialLayout()` | Genera el tablero con la disposición inicial de piezas |
| `findKings(board)` | Localiza ambos reyes: `{ white: {r,c,piece}, black: {r,c,piece} }` |
| `boardSignature(state)` | Genera una firma compacta del estado (para detección de repetición) |
| `cloneState(state)` | Clon profundo del estado completo (para simulación en búsqueda) |
| `lineClear(board, r1,c1, r2,c2)` | Verifica si no hay piezas entre dos posiciones en línea |
| `countBetween(board, r1,c1, r2,c2)` | Cuenta piezas entre dos posiciones (para cañón) |
| `pathSquares(r1,c1, r2,c2)` | Lista todas las casillas entre dos posiciones |

---

## 3.7 Estado del Palacio (`state.js`)

### `updatePalaceState(state)`

Se llama después de cada movimiento para actualizar el estado del palacio:

1. Para cada bando, verifica si hay piezas enemigas dentro del palacio.
2. **Si hay invasores:**
   - Incrementa `palaceTimers[side].pressure`.
   - Si la presión alcanza 3 → `palaceTaken[side] = true`.
   - Incrementa `palaceCurse[side].turnsInPalace`.
   - Si los turnos en palacio alcanzan 3 → activa la maldición (`palaceCurse[side].active = true`).
3. **Si no hay invasores:** Reinicia todos los contadores.

### `isPalaceCursedFor(state, side)`

Retorna `true` si la maldición de palacio está activa para el bando dado. La maldición modifica el movimiento del Rey y la Reina.

### `getPalaceInvaders(state, side)`

Retorna una lista de piezas enemigas actualmente dentro del palacio del bando dado.

---

## 3.8 Mecánica del Arquero (`archer.js`)

### `getArcherBlockedSquares(archerRow, archerCol, archerSide)`

Calcula las 3 casillas que un arquero en la orilla bloquea:
- La casilla directamente al frente (2 filas adelante cruzando el río).
- Las casillas diagonal-izquierda y diagonal-derecha.

### `isSquareProtectedByArcher(state, targetRow, targetCol, protectorSide)`

Verifica si una casilla está en la zona bloqueada de algún arquero del bando protector. Las piezas no pueden moverse ni hacer drop a casillas protegidas por arqueros enemigos.

### `getArcherAmbushResult(state, archer, bankPos)`

Calcula el resultado de una emboscada cuando un arquero llega a la orilla:
- **`null`:** Sin víctimas.
- **`singleCapture`:** Una víctima → captura automática.
- **`autoCaptureAll`:** Todas las víctimas no pueden retroceder → captura masiva.
- **`chooseCapture`:** Múltiples víctimas → el jugador elige.

### `executeArcherAmbush(state, choice)`

Ejecuta la emboscada elegida: captura la víctima seleccionada, retrocede las demás (si pueden), o las captura (si no pueden retroceder).
