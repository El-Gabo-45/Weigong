# 1. Visión General — Wéigōng (圍宮)

## 1.1 Concepto del Juego

Wéigōng (圍宮, "Asedio al Palacio") es un juego de estrategia por turnos para dos jugadores en un tablero de 13×13 casillas. Está inspirado en el Xiangqi (ajedrez chino) pero introduce mecánicas originales como:

- **Río central** que divide el tablero y modifica el movimiento de ciertas piezas.
- **Palacios** en cada extremo del tablero con mecánicas de asedio y maldición.
- **Sistema de reserva** donde ciertas piezas capturadas pueden ser reintroducidas.
- **Promoción opcional** al llegar a territorio enemigo.
- **Modo especial del arquero** en la orilla del río (emboscada).

---

## 1.2 El Tablero

```
     A  B  C  D  E  F  G  H  I  J  K  L  M
  1  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐  ← Territorio Negro
  2  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │  ← Palacio Negro (cols F-H, filas 1-3)
  3  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │
  4  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  5  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← Orilla (bank) de Negro
  6  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  7  │~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│  ← RÍO (fila 7, índice 6)
  8  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  9  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← Orilla (bank) de Blanco
 10  │  │  │  │  │  │  │  │  │  │  │  │  │  │
 11  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │  ← Palacio Blanco (cols F-H, filas 11-13)
 12  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │
 13  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘  ← Territorio Blanco
```

### Zonas Especiales

| Zona | Ubicación (índices) | Descripción |
|------|-------------------|-------------|
| **Río** | Fila 6 (`RIVER_ROW = 6`) | Ninguna pieza puede terminar su turno en esta fila. Algunas piezas saltan el río automáticamente. |
| **Palacio Negro** | Filas 0-2, Columnas 5-7 | Zona sagrada del rey negro. Sujeta a mecánicas de asedio y maldición. |
| **Palacio Blanco** | Filas 10-12, Columnas 5-7 | Zona sagrada del rey blanco. Mismas mecánicas. |
| **Zona de Promoción** | Últimas 3 filas del territorio enemigo | Las piezas promotables pueden ascender al llegar aquí. |
| **Orilla (Bank)** | Fila antes del río en cada lado | Posición especial para el arquero (activa emboscada). |

### Constantes del Tablero (`src/constants.js`)

```javascript
BOARD_SIZE       = 13    // Dimensión del tablero
RIVER_ROW        = 6     // Fila del río
PALACE_COL_START = 5     // Columna inicio del palacio
PALACE_COL_END   = 7     // Columna fin del palacio
```

---

## 1.3 Disposición Inicial

La disposición inicial del tablero sigue un esquema simétrico:

### Lado Negro (filas superiores)

| Fila | Contenido |
|------|-----------|
| Fila 0 (fondo) | Torre · Cañón · Caballo · Sacerdote · Elefante · General · **Rey** · Reina · Elefante · Sacerdote · Caballo · Cañón · Torre |
| Fila 1 (intermedia) | — · Carruaje · — · — · — · — · Arquero · — · — · — · — · Carruaje · — |
| Fila 2 (frente) | Peón × 13 |

### Lado Blanco (filas inferiores)

Espejo del lado negro (la fila 12 es el fondo blanco, con el orden invertido horizontalmente).

---

## 1.4 Sistema de Turnos

1. **Blanco siempre juega primero** (`state.turn` inicia como `SIDE.WHITE`).
2. Cada turno, el jugador activo puede:
   - **Mover** una pieza de su color.
   - **Colocar (drop)** una pieza de su reserva en una casilla válida.
3. Tras cada movimiento se evalúa:
   - **Jaque** (`isKingInCheck`)
   - **Jaque mate** (`checkmate`)
   - **Ahogado** (`stalemate`)
   - **Mate de palacio** (`palacemate`)
   - **Empate por repetición** (triple repetición de posición)

---

## 1.5 Condiciones de Victoria

| Condición | Descripción |
|-----------|-------------|
| **Jaque Mate** | El rey del oponente está en jaque y no tiene movimientos legales. |
| **Mate de Palacio** | El rey está atrapado dentro de su propio palacio, con piezas enemigas dentro y sin posibilidad de escapar ni expulsar a los invasores. |
| **Ahogado** | El jugador no tiene movimientos legales pero no está en jaque → empate. |
| **Triple Repetición** | La misma posición exacta ocurre 3 veces → empate. |

---

## 1.6 Mecánicas Especiales

### 1.6.1 Sistema de Reserva y Drop

Cuando ciertas piezas son capturadas, van a la **reserva** del captor (no se eliminan del juego):

| Pieza | Reutilizable | Notas |
|-------|-------------|-------|
| Torre | ✓ | Va a reserva al ser capturada |
| General | ✓ | Va a reserva al ser capturada |
| Peón | ✓ | Va a reserva al ser capturada |
| Ballesta | ✓ | Va a reserva al ser capturada |
| Todas las demás | ✗ | Se eliminan permanentemente |

**Reglas del Drop:**
- Solo se puede colocar en casillas vacías.
- No se puede colocar en la fila del río.
- La pieza colocada debe estar en el lado propio del tablero (excepto la ballesta, que puede colocarse en cualquier parte).
- No se puede colocar en casillas protegidas por un arquero enemigo.
- Después del drop, el rey propio no debe quedar en jaque.

### 1.6.2 Promoción

Las piezas promotables pueden ascender opcionalmente al llegar a la **zona de promoción** (últimas 3 filas del territorio enemigo):

| Pieza | Símbolo Base | Símbolo Promocionado | Nuevo Nombre |
|-------|-------------|---------------------|-------------|
| Elefante | 象 | 毅 | Elefante Fortalecido |
| Sacerdote | 仙 | 叡 | Sacerdote Iluminado |
| Caballo | 馬 | 駿 | Corcel |
| Cañón | 炮 | 熕 | Cañón Pesado |
| Torre | 塔 | 𨐌 | Torre Mejorada |
| Peón | 兵 | 弩 | Ballesta |

**Piezas NO promotables:** Rey, Reina, General, Carruaje, Arquero.

### 1.6.3 Emboscada del Arquero

Cuando un arquero se mueve a la **orilla del río** (bank row), activa la mecánica de **emboscada**:

1. Se identifican las piezas enemigas en las 3 casillas bloqueadas (frente, frente-izquierda, frente-derecha del lado opuesto del río).
2. Posibles resultados:
   - **Sin víctimas:** No pasa nada.
   - **Una víctima:** Se captura automáticamente.
   - **Múltiples víctimas:** El jugador elige cuál capturar; las demás retroceden si pueden, o son capturadas también si están bloqueadas.

### 1.6.4 Maldición de Palacio (Palace Curse)

Si piezas enemigas permanecen dentro del palacio de un jugador durante **3 turnos consecutivos**, se activa la **maldición de palacio**:

- **Efecto sobre el Rey:** Solo puede moverse en líneas rectas (ortogonales), pierde movimiento diagonal.
- **Efecto sobre la Reina:** Solo puede moverse en diagonales, pierde movimiento ortogonal.
- **Desactivación:** Si todas las piezas enemigas abandonan el palacio, la maldición se desactiva y los contadores se reinician.

### 1.6.5 Asedio de Palacio (Palace Taken)

Si piezas enemigas permanecen dentro del palacio durante **3 turnos con presión**, el palacio se considera "tomado" (`palaceTaken`). Esto influye en la evaluación de la IA y puede llevar a un mate de palacio.
