# 8. Interfaz de Usuario

La interfaz web del juego está construida con HTML5, CSS3 y JavaScript vanilla (sin frameworks), usando ES Modules directamente en el navegador.

---

## 8.1 Punto de Entrada (`index.html`)

El HTML define la estructura completa de la UI:

### Layout Principal

```html
<div id="app">
  ├── <header>               <!-- Logo + título "Wéigōng 圍宮" -->
  │
  ├── <div id="reserveBlack">  <!-- Reserva de piezas negras -->
  │
  ├── <div id="board">         <!-- Tablero 13×13 (CSS grid) -->
  │
  ├── <div id="reserveWhite">  <!-- Reserva de piezas blancas -->
  │
  ├── <div id="controls">      <!-- Panel de controles -->
  │   ├── turnLabel            <!-- Indicador de turno -->
  │   ├── phaseLabel           <!-- Indicador de fase -->
  │   ├── difficultySelect     <!-- Selector de dificultad (1-10) -->
  │   ├── resetBtn             <!-- Botón de reinicio -->
  │   ├── botToggleBtn         <!-- Activar/desactivar bot -->
  │   ├── aiVsAiBtn            <!-- Modo IA vs IA -->
  │   ├── trainBtn             <!-- Modo entrenamiento -->
  │   ├── loadGameBtn          <!-- Cargar partida guardada -->
  │   └── loadGameInput        <!-- Input de archivo para partida -->
  │
  ├── <div id="rulesSummary">  <!-- Resumen de reglas -->
  │
  ├── <div id="messageBar">    <!-- Barra de mensajes de estado -->
  │
  ├── <div id="moveTimeline">  <!-- Timeline de movimientos -->
  │
  ├── <div id="promotionModal">  <!-- Modal de promoción -->
  │
  ├── <div id="ambushModal">     <!-- Modal de emboscada -->
  │
  └── <div id="dbgPanel">       <!-- Panel de debug (dev) -->
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

## 8.2 Estado Global (`src/state.js`)

### Objeto `state`

Estado del juego creado por `createGame()`:
- `board[13][13]`: Tablero.
- `turn`: Turno actual.
- `reserves`: Piezas en reserva.
- `selected`: Pieza seleccionada.
- `legalMoves`: Movimientos legales calculados.
- `status`: Estado del juego.
- `palaceCurse`, `palaceTaken`, `palaceTimers`: Estado del palacio.

### Objeto `V` (Variables Mutables)

Todas las variables mutables de la aplicación en un solo objeto:

```javascript
V = {
  totalMoves: 0,           // Total de movimientos jugados
  currentGameNotation: [],  // Array de notación del juego actual
  gameMovesData: [],        // Datos detallados de cada movimiento
  humanGameFinalized: false, // ¿Se ha finalizado la partida humana?

  aiVsAiMode: false,        // Modo IA vs IA activo
  aiVsAiRunning: false,     // IA vs IA ejecutándose
  aiVsAiMoves: [],          // Movimientos de la partida IA vs IA

  trainingMode: false,      // Modo entrenamiento activo
  trainingCount: 0,         // Partidas de entrenamiento completadas
  trainingRunning: false,   // Entrenamiento ejecutándose

  selectedReserve: null,     // Pieza de reserva seleccionada
  pendingMove: null,         // Movimiento pendiente (esperando confirmación)
  pendingAmbush: null,       // Emboscada pendiente (esperando elección)
  botEnabled: false,         // Bot habilitado
  botThinking: false,        // Bot computando movimiento
  botTimeout: null,          // Timer del bot
  botToken: 0,               // Token para cancelar computaciones obsoletas

  timelineSnapshots: [],     // Snapshots para navegación temporal
  viewPly: 0,                // Ply actualmente visualizado
};
```

### Referencias DOM

Todos los elementos DOM se exportan como constantes:
- `boardEl`, `turnLabel`, `phaseLabel`, `reserveWhite`, `reserveBlack`
- `resetBtn`, `botToggleBtn`, `promotionModal`, `ambushModal`
- `difficultySelect`, `aiVsAiBtn`, `trainBtn`, `messageBar`
- `moveTimeline`, `loadGameBtn`, `loadGameInput`

### Constante `COLS`

```javascript
COLS = "ABCDEFGHIJKLM"  // Letras de columna para notación
```

---

## 8.3 Gameplay (`src/ui/gameplay.js`)

### Función `render()`

Función principal de renderizado que actualiza toda la UI:

1. **Tablero:** Limpia y regenera las 169 celdas:
   - Celdas de río → clase `river-cell`.
   - Celdas de palacio → clase `palace-cell`.
   - Piezas → `pieceLabel()` con kanji y color del bando.
   - Último movimiento → clase `last-move-cell`.
   - Movimientos legales → clase `legal-move-cell`.
   - Pieza seleccionada → clase `selected-cell`.
2. **Reservas:** Muestra piezas capturables para cada bando.
3. **Controles:** Actualiza indicadores de turno, fase y estado.
4. **Barra de mensajes:** Muestra el mensaje de estado actual.
5. **Resumen de reglas:** Actualiza información de maldición/palacio.

### Interacción con el Tablero

```
Click en celda
    │
    ├─ ¿Hay pieza seleccionada?
    │   ├─ ¿El click es un movimiento legal? → executeBoardMove()
    │   └─ ¿El click es otra pieza propia? → seleccionar nueva pieza
    │
    └─ ¿Sin selección?
        ├─ ¿Click en pieza propia? → seleccionar, calcular legalMoves
        └─ ¿Click en vacío? → deseleccionar
```

### `executeBoardMove(move)`

1. Aplica el movimiento con `applyMove()`.
2. Verifica emboscada del arquero → `executeArcherAmbush()`.
3. Evalúa post-movimiento → `afterMoveEvaluation()`.
4. Registra snapshot para timeline.
5. Genera notación algebraica.
6. Si el bot está habilitado → programa `handleBotTurn()` con delay.
7. Re-renderiza.

### `handleBotTurn()`

1. Genera un token único para esta computación.
2. Envía la posición al servidor (`/api/bot`) o computa localmente.
3. Si el token sigue siendo válido → aplica el movimiento del bot.
4. Verifica promoción, emboscada, fin de juego.
5. Re-renderiza.

### Modal de Promoción

Cuando una pieza llega a la zona de promoción:
1. Muestra el modal con opciones "Promover" / "Declinar".
2. Espera la decisión del jugador.
3. Aplica o rechaza la promoción.

### Modal de Emboscada

Cuando un arquero activa la emboscada con múltiples víctimas:
1. Muestra el modal con las opciones de captura.
2. Cada opción muestra la pieza víctima y su ubicación.
3. El jugador elige cuál capturar.

### Guardado de Partida

Cuando termina una partida (`finalizeHumanGame()`):
1. Recolecta todos los datos de movimientos.
2. Comprime con pako (gzip).
3. Envía a `/api/saveGame`.
4. Guarda la memoria adaptativa.

### Modo IA vs IA

1. `toggleAiVsAi()` activa el modo.
2. Ambos bandos juegan automáticamente con `chooseBotMove()`.
3. Todos los movimientos se registran.
4. Al terminar, guarda la partida y muestra el resultado.

### Modo Entrenamiento

1. `toggleTraining()` activa el modo.
2. Ejecuta múltiples partidas IA vs IA secuencialmente.
3. Aprende de cada partida con `/api/learnFromGames`.
4. Muestra estadísticas de progreso.

---

## 8.4 Editor de Tablero (`src/ui/editor.js`)

### Funcionalidad

El editor permite modificar libremente el tablero sin reglas:
- **Colocar piezas:** Seleccionar tipo y bando, click en casilla.
- **Borrar piezas:** Modo borrado, click en pieza para eliminar.
- **Promover:** Seleccionar pieza en tablero, click "Promover".
- **Limpiar tablero:** Eliminar todas las piezas.
- **Reiniciar:** Restaurar la disposición inicial.

### Panel del Editor

Panel flotante fijo a la derecha con:
- Selector de bando (Negro/Blanco).
- Paleta de piezas (12 tipos con kanji).
- Botones de acción: Colocar, Borrar, Limpiar Todo, Reiniciar, Promover, Cerrar.
- Barra de estado mostrando la acción actual.

### Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `Ctrl+Shift+E` | Abrir/cerrar editor |

### Integración con el Tablero

El editor sobrescribe el handler de click del tablero:
- En modo editor, los clicks colocan/borran piezas.
- Al cerrar el editor, se restaura el comportamiento normal de juego.

---

## 8.5 Timeline de Movimientos (`src/ui/timeline.js`)

### Funcionalidad

Permite navegar por el historial de la partida movimiento a movimiento:

### Snapshots

Cada movimiento genera un `snapshotForTimeline()` que contiene:
```javascript
{
  totalMoves: number,       // Número de movimiento
  notation: string[],       // Notación acumulada
  state: { ... },           // Copia completa del estado
}
```

### Renderizado

`renderTimeline()` genera botones clickeables:
- **⏮ Inicio:** Vuelve al principio.
- **1. Ke2:** Click para ir al movimiento 1.
- **2. pH5:** Click para ir al movimiento 2.
- El botón activo está resaltado.

### Navegación

`goToPly(ply)`:
1. Encuentra el snapshot correspondiente.
2. Restaura el estado completo con `restoreFromTimelineSnapshot()`.
3. Actualiza `viewPly`.
4. Re-renderiza.
5. Hace scroll al botón activo.

### Carga de Partida

El timeline también maneja la carga de partidas guardadas:
1. Lee el archivo JSON.
2. Reinicia el juego.
3. Reproduce cada movimiento secuencialmente.
4. Genera snapshots para cada ply.
5. Permite navegación libre.

### Notación Terminal

Al final de la partida, se agrega un sufijo:
| Estado | Sufijo | Significado |
|--------|--------|-------------|
| `checkmate` | `#` | Jaque mate |
| `palacemate` | `##` | Mate de palacio |
| `stalemate` | `^` | Ahogado |
| `draw` | `=` | Empate |
| `draw_move_limit` | `/` | Empate por límite de movimientos |
| `draw_agreement` | `==` | Empate por acuerdo |

---

## 8.6 Estilos (`styles.css`)

### Esquema de Colores

| Variable | Valor | Uso |
|----------|-------|-----|
| `--bg` | `#0a0e14` | Fondo principal |
| `--surface` | `#0f141c` | Superficie de paneles |
| `--border` | `#1a2033` | Bordes |
| `--text` | `#c5d0e0` | Texto principal |
| `--muted` | `#3a4560` | Texto secundario |
| `--accent` | `#8ab4ff` | Acentos (selección) |
| `--white-piece` | `#65d38a` | Color de pieza blanca |
| `--black-piece` | `#c084fc` | Color de pieza negra |
| `--river` | `#112240` | Fondo del río |
| `--palace` | `#1a1530` | Fondo del palacio |

### Tablero

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

### Responsivo

El diseño se adapta a pantallas más pequeñas reduciendo el tamaño de las celdas y reorganizando los paneles.
