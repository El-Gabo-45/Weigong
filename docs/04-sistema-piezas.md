# 4. Sistema de Piezas

Referencia completa de cada pieza del juego, incluyendo movimiento base, movimiento tras promoción, valores de evaluación, y comportamientos especiales.

---

## 4.1 Tabla Resumen

| Pieza | Kanji | Kanji Promo | Valor Base | Valor Promo | Reutilizable | Promotable |
|-------|-------|-------------|-----------|-------------|--------------|------------|
| Rey (King) | 王 | — | 0 (∞) | — | ✗ | ✗ |
| Reina (Queen) | 后 | — | 950 | — | ✗ | ✗ |
| General | 師 | — | 560 | — | ✓ | ✗ |
| Elefante (Elephant) | 象 | 毅 | 240 | 320 | ✗ | ✓ |
| Sacerdote (Priest) | 仙 | 叡 | 400 | 540 | ✗ | ✓ |
| Caballo (Horse) | 馬 | 駿 | 320 | 430 | ✗ | ✓ |
| Cañón (Cannon) | 炮 | 熕 | 450 | 540 | ✗ | ✓ |
| Torre (Tower) | 塔 | 𨐌 | 520 | 650 | ✓ | ✓ |
| Carruaje (Carriage) | 輦 | — | 390 | — | ✗ | ✗ |
| Arquero (Archer) | 矢 | — | 450 | — | ✗ | ✗ |
| Peón (Pawn) | 兵 | 弩 | 110 | 240 | ✓ | ✓ |
| Ballesta (Crossbow) | 弩 | — | 240 | — | ✓ | ✗ |

---

## 4.2 Detalle por Pieza

### 4.2.1 Rey (King) — 王

**Valor:** 0 (invaluable; su captura = derrota)

**Movimiento base:**
- Hasta **2 casillas** en cualquier dirección (ortogonal y diagonal).
- Si la primera casilla tiene una pieza, no puede avanzar a la segunda en esa dirección.

**Bajo maldición de palacio:**
- Pierde movimiento diagonal → solo se mueve en líneas rectas (ortogonales).

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

### 4.2.2 Reina (Queen) — 后

**Valor:** 950

**Movimiento base:**
- Se mueve en las **8 direcciones** (ortogonal y diagonal) sin límite de distancia.
- Se detiene al encontrar otra pieza (puede capturar enemiga).

**Bajo maldición de palacio:**
- Pierde movimiento ortogonal → solo se mueve en diagonales.

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
- **Salto de caballo:** L en forma de 2+1 o 1+2 (como el caballo de ajedrez, 8 posiciones).
- **Diagonal extendida:** Hasta 4 casillas en cualquier diagonal.

**Particularidades:**
- Es reutilizable (va a reserva al ser capturado).
- No es promotable.

```
. ★ . ★ .              Salto de caballo (8 posiciones)
★ . . . ★              + hasta 4 casillas en diagonal
. . 師 . .
★ . . . ★
. ★ . ★ .
```

---

### 4.2.4 Elefante (Elephant) — 象 / 毅

**Valor base:** 240 | **Valor promocionado:** 320

**Movimiento base:**
- **Adelante:** Hasta 2 casillas en la dirección del avance.
- **Diagonal-adelante:** 1 casilla a cada lado (izq/der).
- **Diagonal-atrás:** Hasta 2 casillas en cada diagonal trasera.
- Las casillas intermedias deben estar libres (se bloquea si hay pieza en el camino).

**Movimiento promocionado (毅):**
- Todas las 8 direcciones adyacentes (1 casilla cada una).
- Además, 2 casillas en la dirección de avance.

---

### 4.2.5 Sacerdote (Priest) — 仙 / 叡

**Valor base:** 400 | **Valor promocionado:** 540

**Movimiento base:**
- **Diagonal:** Se mueve en las 4 diagonales sin límite de distancia (como el alfil del ajedrez).
- **Vertical:** 1 casilla hacia adelante y 1 hacia atrás.

**Movimiento promocionado (叡):**
- **Diagonal:** Hasta 4 casillas en cada diagonal.
- **Salto de caballo:** 8 posiciones en L (2+1).

---

### 4.2.6 Caballo (Horse) — 馬 / 駿

**Valor base:** 320 | **Valor promocionado:** 430

**Movimiento base:**
- Salta en **L** como el caballo del ajedrez (2+1 o 1+2).
- Requiere que al menos **una de las dos rutas de acceso** esté libre:
  - **Ruta A:** Dos casillas en la dirección principal.
  - **Ruta B:** Dos casillas en la dirección secundaria.

**Movimiento promocionado (駿):**
- **Todas las 8 casillas adyacentes** (1 casilla en cada dirección).
- **Más** el salto de caballo estándar (8 posiciones en L).

---

### 4.2.7 Cañón (Cannon) — 炮 / 熕

**Valor base:** 450 | **Valor promocionado:** 540

**Movimiento base:**
- **Movimiento sin captura:** Se desplaza en línea recta ortogonal (arriba, abajo, izquierda, derecha) como una torre, pero sin capturar.
- **Captura:** Salta sobre **exactamente una pieza** intermedia para capturar una pieza enemiga más allá.

**Movimiento promocionado (熕):**
- **Movimiento vertical:** Se mueve libremente en vertical (arriba/abajo) como una torre.
- **Captura diagonal:** Salta sobre una pieza en diagonal (↘/↖) para capturar.

---

### 4.2.8 Torre (Tower) — 塔 / 𨐌

**Valor base:** 520 | **Valor promocionado:** 650

**Movimiento base:**
- Se desplaza en línea recta **ortogonal** (arriba, abajo, izquierda, derecha) sin límite de distancia.
- Se detiene al encontrar otra pieza (puede capturar enemiga).

**Movimiento promocionado (𨐌):**
- Se mueve por las diagonales ↗/↙ (horizontal-derecha e izquierda) y las verticales ↑/↓.
- Cambia de eje ortogonal a diagonal mixto.

**Reutilizable:** Sí (va a reserva al ser capturada).

---

### 4.2.9 Carruaje (Carriage) — 輦

**Valor:** 390

**Movimiento:**
- **Ortogonal:** Hasta 4 casillas en las 4 direcciones ortogonales.
- **Diagonal:** 1 casilla en las diagonales ↘ y ↖.
- **Restricción:** Solo puede moverse dentro de su **propio lado** del tablero (no cruza el río).

---

### 4.2.10 Arquero (Archer) — 矢

**Valor:** 450

**Movimiento:**
- **Salto extendido:** En L de 3+1 o 1+3 (como un caballo pero más largo), solo dentro de su propio lado.
- **En la orilla (bank):** Puede moverse 1 casilla hacia el frente (cruzando al otro lado del río) y a las diagonales inmediatas del frente.

**Mecánica especial - Emboscada:**
- Cuando el arquero se mueve a la **orilla del río**, activa la emboscada.
- Bloquea 3 casillas enemigas (frente, frente-izquierda, frente-derecha del otro lado).
- Puede capturar piezas enemigas en esas casillas.

**Restricción:** Solo puede moverse dentro de su propio lado del tablero.

**Bonus de evaluación:** +300 puntos cuando está posicionado en la orilla.

---

### 4.2.11 Peón (Pawn) — 兵 / 弩

**Valor base:** 110 | **Valor promocionado (Ballesta):** 240

**Movimiento base:**
- **En propio territorio:**
  - Avanza 1 casilla hacia adelante (salta el río automáticamente).
  - Captura en diagonal-adelante (1 casilla).
  - Captura a los lados (izquierda/derecha, 1 casilla).
- **En territorio enemigo:**
  - Avanza 1 casilla hacia adelante.
  - Se mueve y captura a los lados (izquierda/derecha).
  - Captura en diagonal-adelante.

**Salto de río:** El peón salta automáticamente la fila del río cuando avanza. Si la casilla destino es la fila del río, se mueve una casilla más allá.

**Promoción a Ballesta (弩):** Al llegar a la zona de promoción (últimas 3 filas enemigas), puede ascender opcionalmente a Ballesta.

---

### 4.2.12 Ballesta (Crossbow) — 弩

**Valor:** 240

**Movimiento:**
- **Adelante:** 1 casilla (con salto de río).
- **Diagonal:** 1 casilla en las 4 diagonales (con salto de río).

**Salto de río:** Si la casilla destino es la fila del río:
- Si el río está vacío → salta al otro lado.
- Si el río tiene una pieza bloqueando → no puede pasar.

**Particularidades:**
- Es reutilizable (va a reserva al ser capturada).
- Puede ser colocada (drop) en **cualquier parte** del tablero (no solo en el propio lado).

---

## 4.3 Notación de Piezas

El juego usa un sistema de notación algebraica propio:

| Pieza | Símbolo | Símbolo Promocionado |
|-------|---------|---------------------|
| King | K | — |
| Queen | Q | — |
| General | G | — |
| Elephant | E | F |
| Priest | P | W |
| Horse | H | S |
| Cannon | C | R |
| Tower | T | U |
| Carriage | Ca | — |
| Archer | A | — |
| Pawn | p | B |
| Crossbow | B | — |

### Formato de Notación

- **Movimiento normal:** `KG7` (Rey a G7)
- **Captura:** `TxpH5` (Torre captura peón en H5)
- **Promoción:** `pA1+` (Peón a A1, promociona)
- **Drop desde reserva:** `T*E8` (Torre de reserva colocada en E8)
- **Emboscada:** `AE7>HxF5` (Arquero a E7, captura caballo en F5)
- **Jaque mate:** `QxKG1#`
- **Mate de palacio:** `TF2##`
- **Ahogado:** `HG5^`
- **Empate por repetición:** `TF2=`
