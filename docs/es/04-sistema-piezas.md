# 4. Sistema de Piezas

Referencia completa de cada pieza del juego, incluyendo movimiento base, movimiento promocionado, valores de evaluación y comportamientos especiales.

---

## 4.1 Tabla Resumen

| Pieza | Kanji | Kanji Promo | Valor Base | Valor Promo | Reutilizable | Promocionable |
|-------|-------|-------------|-----------|-------------|--------------|---------------|
| Rey | 王 | — | 0 (∞) | — | ✗ | ✗ |
| Reina | 后 | — | 950 | — | ✗ | ✗ |
| General | 師 | — | 560 | — | ✓ | ✗ |
| Elefante | 象 | 毅 | 240 | 320 | ✗ | ✓ |
| Sacerdote | 仙 | 叡 | 400 | 540 | ✗ | ✓ |
| Caballo | 馬 | 駿 | 320 | 430 | ✗ | ✓ |
| Cañón | 炮 | 熕 | 450 | 540 | ✗ | ✓ |
| Torre | 塔 | 𨐌 | 520 | 650 | ✓ | ✓ |
| Carruaje | 輦 | — | 390 | — | ✗ | ✗ |
| Arquero | 矢 | — | 450 | — | ✗ | ✗ |
| Peón | 兵 | 弩 | 110 | 240 | ✓ | ✓ |
| Ballesta | 弩 | — | 240 | — | ✓ | ✗ |

---

## 4.2 Detalle de Piezas

### 4.2.1 Rey — 王

**Valor:** 0 (invaluable; su captura = derrota)

**Movimiento base:**
- Hasta **2 casillas** en cualquier dirección (ortogonal y diagonal).
- Si la primera casilla tiene una pieza, no puede avanzar a la segunda en esa dirección.

**Bajo maldición de palacio:**
- Pierde el movimiento diagonal → solo puede moverse en líneas rectas (ortogonal).

**Regla especial:**
- Dos reyes **no pueden enfrentarse** en la misma columna sin piezas intermedias (regla heredada del Xiangqi). Si esto ocurre, se considera jaque.

```
. . ★ . .      ★ = puede moverse (hasta 2 casillas)
. ★ ★ ★ .      . = casilla vacía
★ ★ 王 ★ ★
. ★ ★ ★ .
. . ★ . .
```

---

### 4.2.2 Reina — 后

**Valor:** 950

**Movimiento base:**
- Se mueve en las **8 direcciones** (ortogonal y diagonal) sin límite de distancia.
- Se detiene al encontrar otra pieza (puede capturar enemiga).

**Bajo maldición de palacio:**
- Pierde el movimiento ortogonal → solo puede moverse en diagonal.

```
★ . . ★ . . ★
. ★ . ★ . ★ .
. . ★ ★ ★ . .
★ ★ ★ 后 ★ ★ ★
. . ★ ★ ★ . .
. ★ . ★ . ★ .
★ . . ★ . . ★
```

---

### 4.2.3 General — 師

**Valor:** 560

**Movimiento:**
- **Salto de caballo:** En L de 2+1 o 1+2 (como un caballo de ajedrez, 8 posiciones).
- **Diagonal extendida:** Hasta 4 casillas en cualquier diagonal.

**Particularidades:**
- Es reutilizable (va a la reserva al ser capturado).
- No es promocionable.

```
. ★ . ★ .              Salto de caballo (8 posiciones)
★ . . . ★              + hasta 4 casillas diagonales
. . 師 . .
★ . . . ★
. ★ . ★ .
```

---

### 4.2.4 Elefante — 象 / 毅

**Valor base:** 240 | **Valor promocionado:** 320

**Movimiento base:**
- **Adelante:** Hasta 2 casillas en la dirección de avance.
- **Diagonal frontal:** 1 casilla a cada lado (izquierda/derecha).
- **Diagonal trasera:** Hasta 2 casillas en cada diagonal trasera.
- Las casillas intermedias deben estar libres (bloqueado si hay una pieza en el camino).

**Movimiento promocionado (毅):**
- Las 8 direcciones adyacentes (1 casilla cada una).
- Además, 2 casillas en la dirección de avance.

---

### 4.2.5 Sacerdote — 仙 / 叡

**Valor base:** 400 | **Valor promocionado:** 540

**Movimiento base:**
- **Diagonal:** Se mueve en las 4 diagonales sin límite de distancia (como un alfil de ajedrez).
- **Vertical:** 1 casilla adelante y 1 atrás.

**Movimiento promocionado (叡):**
- **Diagonal:** Hasta 4 casillas en cada diagonal.
- **Salto de caballo:** 8 posiciones en L (2+1).

---

### 4.2.6 Caballo — 馬 / 駿

**Valor base:** 320 | **Valor promocionado:** 430

**Movimiento base:**
- Salta en **L** como un caballo de ajedrez (2+1 o 1+2).
- Requiere que al menos **una de las dos rutas de acceso** esté libre:
  - **Ruta A:** Dos casillas en la dirección principal.
  - **Ruta B:** Dos casillas en la dirección secundaria.

**Movimiento promocionado (駿):**
- **Todas las 8 casillas adyacentes** (1 casilla en cada dirección).
- **Más** el salto estándar de caballo (8 posiciones en L).

---

### 4.2.7 Cañón — 炮 / 熕

**Valor base:** 450 | **Valor promocionado:** 540

**Movimiento base:**
- **Movimiento sin captura:** Se mueve en línea recta ortogonal (arriba, abajo, izquierda, derecha) como una torre, pero sin capturar.
- **Captura:** Salta sobre **exactamente una** pieza intermedia para capturar una pieza enemiga más allá.

**Movimiento promocionado (熕):**
- **Movimiento vertical:** Se mueve libremente en vertical (arriba/abajo) como una torre.
- **Captura diagonal:** Salta sobre una pieza en diagonal (↘/↖) para capturar.

---

### 4.2.8 Torre — 塔 / 𨐌

**Valor base:** 520 | **Valor promocionado:** 650

**Movimiento base:**
- Se mueve en línea recta **ortogonal** (arriba, abajo, izquierda, derecha) sin límite de distancia.
- Se detiene al encontrar otra pieza (puede capturar enemiga).

**Movimiento promocionado (𨐌):**
- Se mueve por las diagonales ↗/↙ y las verticales ↑/↓.
- Cambia de eje ortogonal a eje diagonal mixto.

**Reutilizable:** Sí (va a la reserva al ser capturada).

---

### 4.2.9 Carruaje — 輦

**Valor:** 390

**Movimiento:**
- **Ortogonal:** Hasta 4 casillas en las 4 direcciones ortogonales.
- **Diagonal:** 1 casilla en las diagonales ↘ y ↖.
- **Restricción:** Solo puede moverse en su **propio lado** del tablero (no cruza el río).

---

### 4.2.10 Arquero — 矢

**Valor:** 450

**Movimiento:**
- **Salto extendido:** En L de 3+1 o 1+3 (como un caballo pero más largo), solo en su propio lado.
- **En la orilla:** Puede moverse 1 casilla al frente (cruzando al otro lado del río) y a las diagonales frontales inmediatas.

**Mecánica especial — Emboscada:**
- Cuando el arquero se mueve a la **orilla del río**, activa la emboscada.
- Bloquea 3 casillas enemigas (frente, frente-izquierda, frente-derecha del otro lado).
- Puede capturar piezas enemigas en esas casillas.

**Restricción:** Solo puede moverse en su propio lado del tablero.

**Bonus de evaluación:** +300 puntos cuando está posicionado en la orilla.

---

### 4.2.11 Peón — 兵 / 弩

**Valor base:** 110 | **Valor promocionado (Ballesta):** 240

**Movimiento base:**
- **En territorio propio:**
  - Avanza 1 casilla al frente (salta el río automáticamente).
  - Captura en diagonal frontal (1 casilla).
  - Captura lateralmente (izquierda/derecha, 1 casilla).
- **En territorio enemigo:**
  - Avanza 1 casilla al frente.
  - Se mueve y captura lateralmente (izquierda/derecha).
  - Captura en diagonal frontal.

**Salto del río:** El peón salta automáticamente la fila del río al avanzar. Si la casilla destino es la fila del río, se mueve una casilla más allá.

**Promoción a Ballesta (弩):** Al llegar a la zona de promoción (últimas 3 filas enemigas), puede ascender opcionalmente a Ballesta.

---

### 4.2.12 Ballesta — 弩

**Valor:** 240

**Movimiento:**
- **Adelante:** 1 casilla (con salto de río).
- **Diagonal:** 1 casilla en las 4 diagonales (con salto de río).

**Salto de río:** Si la casilla destino es la fila del río:
- Si el río está vacío → salta al otro lado.
- Si el río tiene una pieza bloqueando → no puede pasar.

**Particularidades:**
- Es reutilizable (va a la reserva al ser capturada).
- Puede colocarse **en cualquier lugar** del tablero (no solo en su propio lado).

---

## 4.3 Notación de Piezas

El juego usa su propio sistema de notación algebraica:

| Pieza | Símbolo | Símbolo Promocionado |
|-------|---------|---------------------|
| Rey | K | — |
| Reina | Q | — |
| General | G | — |
| Elefante | E | F |
| Sacerdote | P | W |
| Caballo | H | S |
| Cañón | C | R |
| Torre | T | U |
| Carruaje | Ca | — |
| Arquero | A | — |
| Peón | p | B |
| Ballesta | B | — |

### Formato de Notación

- **Movimiento normal:** `KG7` (Rey a G7)
- **Captura:** `TxpH5` (Torre captura peón en H5)
- **Promoción:** `pA1+` (Peón a A1, promociona)
- **Colocación desde reserva:** `T*E8` (Torre de la reserva colocada en E8)
- **Emboscada:** `AE7>HxF5` (Arquero a E7, captura caballo en F5)
- **Jaque mate:** `QxKG1#`
- **Mate de palacio:** `TF2##`
- **Ahogado:** `HG5^`
- **Empate por repetición:** `TF2=`
