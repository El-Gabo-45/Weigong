# 1. Visión General — Wéigōng (圍宮)

## 1.1 Concepto del Juego

Wéigōng (圍宮, "Asedio al Palacio") es un juego de estrategia por turnos para dos jugadores en un tablero de 13×13. Está inspirado en el Xiangqi (ajedrez chino) pero introduce mecánicas originales como:

- **Río central** que divide el tablero y modifica el movimiento de ciertas piezas.
- **Palacios** en cada extremo del tablero con mecánicas de asedio y maldición.
- **Sistema de reserva** donde ciertas piezas capturadas pueden ser reintroducidas.
- **Promoción opcional** al llegar a territorio enemigo.
- **Modo emboscada del arquero** en la orilla del río.

---

## 1.2 El Tablero

```
     A  B  C  D  E  F  G  H  I  J  K  L  M
  1  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐  ← Territorio Negro
  2  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │  ← Palacio Negro (cols F-H, filas 1-3)
  3  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │
  4  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  5  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← Orilla Negra
  6  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  7  │~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│  ← RÍO (fila 7, índice 6)
  8  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  9  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← Orilla Blanca
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
| **Zona de Promoción** | Últimas 3 filas del territorio enemigo | Las piezas promocionables pueden ascender al llegar aquí. |
| **Orilla** | Fila antes del río en cada lado | Posición especial para el arquero (activa emboscada). |

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
| Fila 0 (trasera) | Torre · Cañón · Caballo · Sacerdote · Elefante · General · **Rey** · Reina · Elefante · Sacerdote · Caballo · Cañón · Torre |
| Fila 1 (media) | — · Carruaje · — · — · — · — · Arquero · — · — · — · — · Carruaje · — |
| Fila 2 (frontal) | Peón × 13 |

### Lado Blanco (filas inferiores)

Espejo del lado negro (fila 12 es la trasera blanca, con orden invertido horizontalmente).

---

## 1.4 Sistema de Turnos

1. **Blanco siempre juega primero** (`state.turn` se inicializa como `SIDE.WHITE`).
2. En cada turno, el jugador activo puede:
   - **Mover** una pieza de su color.
   - **Colocar** una pieza de su reserva en una casilla válida.
3. Después de cada movimiento se evalúa:
   - **Jaque** (`isKingInCheck`)
   - **Jaque mate** (`checkmate`)
   - **Ahogado** (`stalemate`)
   - **Mate de palacio** (`palacemate`)
   - **Empate por repetición** (triple repetición de posición)

---

## 1.5 Condiciones de Victoria

| Condición | Descripción |
|-----------|-------------|
| **Jaque mate** | El rey del oponente está en jaque y no tiene movimientos legales. |
| **Mate de palacio** | El rey está atrapado dentro de su propio palacio con piezas enemigas dentro y sin posibilidad de escapar o expulsar a los invasores. |
| **Ahogado** | El jugador no tiene movimientos legales pero no está en jaque → empate. |
| **Triple repetición** | La misma posición exacta ocurre 3 veces → empate. |

---

## 1.6 Mecánicas Especiales

### 1.6.1 Sistema de Reserva y Colocación

Cuando ciertas piezas son capturadas, van a la **reserva** del captor (no se eliminan del juego):

| Pieza | Reutilizable | Notas |
|-------|-------------|-------|
| Torre | ✓ | Va a la reserva al ser capturada |
| General | ✓ | Va a la reserva al ser capturado |
| Peón | ✓ | Va a la reserva al ser capturado |
| Ballesta | ✓ | Va a la reserva al ser capturada |
| Todas las demás | ✗ | Eliminadas permanentemente |

**Reglas de colocación:**
- Solo se puede colocar en casillas vacías.
- No se puede colocar en la fila del río.
- La pieza colocada debe estar en el lado propio del tablero (excepto la ballesta, que puede colocarse en cualquier lugar).
- No se puede colocar en casillas protegidas por un arquero enemigo.
- Después de la colocación, el rey propio no debe estar en jaque.

### 1.6.2 Promoción

Las piezas promocionables pueden ser ascendidas opcionalmente al llegar a la **zona de promoción** (últimas 3 filas del territorio enemigo):

| Pieza | Símbolo Base | Símbolo Promocionado | Nombre Promocionado |
|-------|-------------|---------------------|-------------------|
| Elefante | 象 | 毅 | Elefante Fortificado |
| Sacerdote | 仙 | 叡 | Sacerdote Iluminado |
| Caballo | 馬 | 駿 | Corcel |
| Cañón | 炮 | 熕 | Cañón Pesado |
| Torre | 塔 | 𨐌 | Torre Mejorada |
| Peón | 兵 | 弩 | Ballesta |

**Piezas no promocionables:** Rey, Reina, General, Carruaje, Arquero.

### 1.6.3 Emboscada del Arquero

Cuando un arquero se mueve a la **orilla del río** (fila de la orilla), activa la mecánica de **emboscada**:

1. Se identifican las piezas enemigas en las 3 casillas bloqueadas (frente, frente-izquierda, frente-derecha del otro lado del río).
2. Posibles resultados:
   - **Sin víctimas:** No pasa nada.
   - **Una víctima:** Capturada automáticamente.
   - **Múltiples víctimas:** El jugador elige cuál capturar; las demás retroceden si pueden, o también son capturadas si están bloqueadas.

### 1.6.4 Maldición de Palacio

Si piezas enemigas permanecen dentro del palacio de un jugador durante **3 turnos consecutivos**, se activa la **maldición de palacio**:

- **Efecto en el Rey:** Solo puede moverse en líneas rectas (ortogonal), pierde el movimiento diagonal.
- **Efecto en la Reina:** Solo puede moverse en diagonal, pierde el movimiento ortogonal.
- **Desactivación:** Si todas las piezas enemigas abandonan el palacio, la maldición se desactiva y los contadores se reinician.

### 1.6.5 Asedio de Palacio (Palacio Tomado)

Si las piezas enemigas permanecen dentro del palacio durante **3 turnos con presión**, el palacio se considera "tomado" (`palaceTaken`). Esto influye en la evaluación de la IA y puede llevar a un mate de palacio.
