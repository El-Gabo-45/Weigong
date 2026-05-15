# Wéigōng (圍宮) - 13x13 Strategy Game

Local single-player strategy game. Developed as a modular web project.

---

## 🚀 How to Run / Cómo abrirlo

Run a local server in the project folder:
Ejecuta un servidor local en la carpeta del proyecto:

```bash
# Option 1: Node.js (npm)
npm start

# Option 2: npm (just engine)
npm install @el-gabo-45/weigong-engine

# Option 3: npm (full version with UI)
npm install @el-gabo-45/weigong
```

Then open in your browser / Luego abre:
- `http://localhost:3000`

---

## 📂 Project Structure / Archivos

- `index.html` — Main entry point / Entrada principal.
- `styles.css` — Board and UI styles / Tablero y UI.
- `engine/constants.js` — Constants and utilities / Constantes y utilidades.
- `engine/rules/` — Core game engine / Motor de reglas.
- `engine/ai/` — Game AI / IA del juego.
- `neural_network_gpu/` — Neural Network implementation / Red neuronal.
- `src/main.js` — Interaction and rendering / Interacción y render.
- `src/ui/` — UI components / Interfaz.

---

## 📝 Features / Características

The game is ready for local play with the following features:
La base está lista para jugar en local con:

- **13×13 Board** / Tablero de 13×13.
- **Initial Setup** / Piezas iniciales configuradas.
- **Turn-based Gameplay** / Turnos por color.
- **Capture and Reserve system** / Sistema de captura y reserva.
- **Optional Promotion** / Promoción opcional.
- **Special Archer Mode** / Arquero con modo especial en la orilla.
- **Detection Systems** / Detección de jaque, ahogado y condiciones de palacio.

---

## 📖 Rulebook / Reglamento

### 1. Components / Componentes

| Element | Description / Descripción |
|---|---|
| Board / Tablero | 13×13 squares / casillas |
| River / Río | Dividing strip between rows 6 and 7 / Franja divisoria entre filas 6 y 7 |
| Palaces / Palacios | 3×3 areas in central corners (rows 1–3 and 11–13, columns 5–7) |
| Pieces / Piezas | 26 per side, circular / 26 por bando, circulares |

Pieces are circular with:
- **Front / Anverso:** Base color of the side (white or black), kanji in the opposite color.
- **Back / Reverso:** Red for both sides, with the promoted kanji. Flipped on promotion — permanent.

---

### 2. Piece Symbols / Símbolos de las Piezas (Kanji)

| Piece / Pieza | Base Kanji | Promoted Kanji / Kanji prom. |
|---|---|---|
| King / Rey | 王 | — |
| Queen / Dama | 后 | — |
| General | 師 | — |
| Elephant / Elefante | 象 | 毅 (Fortress/Fortaleza) |
| Priest / Sacerdote | 仙 | 叡 (Wisdom/Sabio) |
| Horse / Caballo | 馬 | 駿 (Steed/Corcel) |
| Cannon / Cañón | 炮 | 熕 (Artillery) |
| Tower / Torre | 塔 | 𨐌 (Resistant/Resistencia) |
| Carriage / Carruaje | 輦 | — |
| Archer / Arquero | 矢 | — |
| Pawn / Peón | 兵 | 弩 (Crossbow/Ballesta) |

---

### 3. Initial Setup / Disposición Inicial

```
Col:  1   2   3   4   5   6   7   8   9  10  11  12  13
R1:  塔  炮  馬  仙  象  師  王  后  象  仙  馬  炮  塔
R2:   .  輦   .   .   .   .  矢   .   .   .   .  輦   .
R3:  兵  兵  兵  兵  兵  兵  兵  兵  兵  兵  兵  兵  兵
```

The opposing side is the mirror image on rows 11–13.
El bando contrario es la imagen especular en filas 11–13.

---

### 4. Piece Movement / Movimiento de las Piezas

| Piece / Pieza | Movement / Movimiento |
|---|---|
| King 王 | 2 squares in any direction, no jumping / 2 casillas en cualquier dirección, no salta |
| Queen 后 | Any number in straight or diagonal (classic chess) / Cualquier número en recta o diagonal |
| General 師 | Knight L (2+1) + up to 5 diagonal squares, no jumping / Caballo L + hasta 5 diagonales, no salta |
| Elephant 象 | 1 diagonal (4 dirs) + 1 forward + 2 diagonal back / 1 diagonal + 1 adelante + 2 diagonal atrás |
| Priest 仙 | Any diagonal + 1 forward and 1 backward straight, no laterals / Cualquier diagonal + 1 adelante y atrás recto |
| Horse 馬 | L (2+1), no jumping, intermediate square must be empty / L, no salta, casilla intermedia vacía |
| Cannon 炮 | Moves like Tower, captures by jumping over one piece / Mueve como Torre, captura saltando sobre una pieza |
| Tower 塔 | Any number in straight lines / Cualquier número en recta |
| Carriage 輦 | 4 straight + 1 any diagonal, jumps, cannot cross river / 4 rectas + 1 diagonal, salta, no cruza el río |
| Archer 矢 | See Section 5 / Ver Sección 5. Cannot cross river / No cruza el río |
| Pawn 兵 | 1 forward (+ sides after crossing river). Captures horizontal and forward diagonal always / 1 adelante (+ lados al cruzar). Captura horizontal y diagonal adelante siempre |

---

### 5. The Archer / El Arquero (矢)

**Movement / Movimiento:**
- On the bank / En orilla: Activates special ability / Activa habilidad especial.
- Off the bank / Fuera de orilla: Long L (3+1).
- Never crosses the river / Nunca cruza el río.

**Block Mode / Bloqueo (Modo Torreta):**
Blocks 3 enemy squares on the other side: frontal + 2 adjacent.
Bloquea 3 casillas enemigas al otro lado: frontal + 2 adyacentes.

| Effect / Efecto | Enemy / Enemigo | Ally / Aliado |
|---|---|---|
| Enter / Entrar | ❌ | ✅ |
| Place reserve / Colocar reserva | ❌ | ✅ |
| Capture allies there / Capturar aliados ahí | ❌ | ✅ Protected |
| Jump over / Saltar sobre | ❌ | ✅ |
| Escape check (King) / Escapar jaque (Rey) | ❌ | N/A |

**Ambush / Emboscada** (when moving to the bank / al mover a orilla):
If there are enemy pieces in the 3 blocked squares / Si hay piezas enemigas en las 3 casillas bloqueadas:
1. You choose one → captured / Eliges una → capturada.
2. The other two → retreat 1 square / Las otras dos → retroceden 1 casilla.
3. If they cannot retreat → also captured / Si no pueden retroceder → también capturadas.

---

### 6. The River / El Río

- Cannot cross / No cruzan: Archer 矢, Carriage 輦.
- Pawns gain lateral movement after crossing / Los Peones ganan lateral al cruzar.

---

### 7. The Palace / El Palacio

- **King's gaze / Mirada de reyes:** Illegal to align kings in palaces without a piece between them / Ilegal alinear reyes en palacios sin pieza entre ellos.
- **Free exit / Salida libre:** King, Queen and General can leave / Rey, Dama y General pueden salir.

**Invasion (3 turns from entry / 3 turnos desde que una pieza entra):**
1. Enemy piece enters the palace / Pieza enemiga entra al palacio.
2. Defender has 3 turns to expel or capture it / Defensor tiene 3 turnos para expulsarla o capturarla.
3. If they fail → palace taken / Si falla → toma del palacio:
   - King: loses diagonal movement (only orthogonal) / Rey: pierde diagonal.
   - Queen: loses straight movement (only diagonal) / Dama: pierde recta.
4. Invading piece leaves → everything restored / Pieza invasora sale → todo se restaura.

---

### 8. Capture Mate / Mate por Captura (Asedio Total)

King in palace + all exits blocked + at least one enemy piece inside the palace = Capture Mate.
Rey en palacio + todas las salidas bloqueadas + al menos una pieza enemiga dentro del palacio = Mate por captura.

---

### 9. Promotions / Promociones

- **Zone / Zona:** Last 3 enemy rows / 3 últimas filas enemigas.
- **Rule / Regla:** Optional each turn in zone. When chosen, piece is flipped to red reverse. Permanent / Opcional cada turno en zona. Al elegir, se gira al reverso rojo. Permanente.

| Piece / Pieza | Base | Promoted / Prom. | Promoted Movement / Movimiento Promocionado |
|---|---|---|---|
| Pawn / Peón | 兵 | 弩 Crossbow | 4 diagonals + 1 straight / 4 diagonales + 1 recta |
| Tower / Torre | 塔 | 𨐌 | Horizontal + right diagonal (/). Loses vertical / Horizontal + diagonal derecha. Pierde vertical |
| Horse / Caballo | 馬 | 駿 | +1 all directions. L tips: +2 extra. Now jumps / +1 todas direcciones. Puntas L: +2 extra. Ahora salta |
| Elephant / Elefante | 象 | 毅 | Gold General + 2nd square straight back / General de Oro + 2ª casilla atrás en recto |
| Priest / Sacerdote | 仙 | 叡 | Gains L (Horse). Diagonal reduced to 4 / Gana L. Diagonal reducida a 4 |
| Cannon / Cañón | 炮 | 熕 | Vertical + left diagonal (\\). Captures by jumping. Loses horizontal / Vertical + diagonal izquierda. Captura saltando. Pierde horizontal |
| Carriage / Carruaje | 輦 | — | Does not promote / No promociona |
| Archer / Arquero | 矢 | — | Does not promote / No promociona |
| King / Rey | 王 | — | Does not promote / No promociona |
| Queen / Dama | 后 | — | Does not promote / No promociona |
| General | 師 | — | Does not promote / No promociona |

---

### 10. Capture and Reserve / Captura y Reutilización (Reserva)

**Reusable pieces / Piezas reutilizables:** 塔 Tower · 師 General · 兵 Pawn · 弩 Crossbow

**Placement rules / Reglas de colocación:**
- **弩 Crossbow:** Any legal empty square on the entire board / Cualquier casilla vacía legal de todo el tablero.
- **塔 · 師 · 兵:** Only on your own side of the river / Solo en tu propio lado del río.
- Placing a piece consumes your full turn / Colocar una pieza consume tu turno completo.
- Always placed in base state (front side) / Siempre se coloca en estado base (anverso).

---

### 11. End of Game / Final de la Partida

**Victories / Victorias:**
- Classic checkmate / Jaque mate clásico.
- Capture mate (total siege) / Mate por captura (asedio total).
- Palace takeover + King capture / Toma del palacio + captura del Rey.

**Draws / Tablas:**
- Stalemate / Ahogado.
- Technical impossibility / Imposibilidad técnica.
- Mutual agreement / Acuerdo mutuo.
- Move limit draw (currently 1000 moves) / Tablas por límite de movimiento (de momento 1000 jugadas).

---

### 12. Visual Identity / Identidad Visual

| Side / Bando | Piece / Ficha | Kanji | Reverse / Reverso |
|---|---|---|---|
| White / Blanco | White / Blanca | Black + promoted kanji (red) / Negro + kanji prom. (rojo) | — |
| Black / Negro | Black / Negra | White + promoted kanji (red) / Blanco + kanji prom. (rojo) | — |