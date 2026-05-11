# 4. Piece System

Complete reference for every piece in the game, including base movement, promoted movement, evaluation values, and special behaviors.

---

## 4.1 Summary Table

| Piece | Kanji | Promo Kanji | Base Value | Promo Value | Reusable | Promotable |
|-------|-------|-------------|-----------|-------------|----------|------------|
| King | 王 | — | 0 (∞) | — | ✗ | ✗ |
| Queen | 后 | — | 950 | — | ✗ | ✗ |
| General | 師 | — | 560 | — | ✓ | ✗ |
| Elephant | 象 | 毅 | 240 | 320 | ✗ | ✓ |
| Priest | 仙 | 叡 | 400 | 540 | ✗ | ✓ |
| Horse | 馬 | 駿 | 320 | 430 | ✗ | ✓ |
| Cannon | 炮 | 熕 | 450 | 540 | ✗ | ✓ |
| Tower | 塔 | 𨐌 | 520 | 650 | ✓ | ✓ |
| Carriage | 輦 | — | 390 | — | ✗ | ✗ |
| Archer | 矢 | — | 450 | — | ✗ | ✗ |
| Pawn | 兵 | 弩 | 110 | 240 | ✓ | ✓ |
| Crossbow | 弩 | — | 240 | — | ✓ | ✗ |

---

## 4.2 Piece Details

### 4.2.1 King — 王

**Value:** 0 (invaluable; its capture = defeat)

**Base movement:**
- Up to **2 squares** in any direction (orthogonal and diagonal).
- If the first square has a piece, it cannot advance to the second in that direction.

**Under palace curse:**
- Loses diagonal movement → can only move in straight lines (orthogonal).

**Special rule:**
- Two kings **cannot face each other** in the same column with no intermediate pieces (rule inherited from Xiangqi). If this occurs, it is considered check.

```
. . ★ . .      ★ = can move (up to 2 squares)
. ★ ★ ★ .      . = empty square
★ ★ 王 ★ ★
. ★ ★ ★ .
. . ★ . .
```

---

### 4.2.2 Queen — 后

**Value:** 950

**Base movement:**
- Moves in all **8 directions** (orthogonal and diagonal) without distance limit.
- Stops upon encountering another piece (can capture enemy).

**Under palace curse:**
- Loses orthogonal movement → can only move diagonally.

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

**Value:** 560

**Movement:**
- **Knight jump:** L-shape of 2+1 or 1+2 (like a chess knight, 8 positions).
- **Extended diagonal:** Up to 4 squares in any diagonal.

**Particularities:**
- Is reusable (goes to reserve when captured).
- Not promotable.

```
. ★ . ★ .              Knight jump (8 positions)
★ . . . ★              + up to 4 diagonal squares
. . 師 . .
★ . . . ★
. ★ . ★ .
```

---

### 4.2.4 Elephant — 象 / 毅

**Base value:** 240 | **Promoted value:** 320

**Base movement:**
- **Forward:** Up to 2 squares in the advance direction.
- **Forward-diagonal:** 1 square on each side (left/right).
- **Backward-diagonal:** Up to 2 squares in each backward diagonal.
- Intermediate squares must be clear (blocked if there is a piece in the way).

**Promoted movement (毅):**
- All 8 adjacent directions (1 square each).
- Additionally, 2 squares in the advance direction.

---

### 4.2.5 Priest — 仙 / 叡

**Base value:** 400 | **Promoted value:** 540

**Base movement:**
- **Diagonal:** Moves in all 4 diagonals without distance limit (like a chess bishop).
- **Vertical:** 1 square forward and 1 backward.

**Promoted movement (叡):**
- **Diagonal:** Up to 4 squares in each diagonal.
- **Knight jump:** 8 L-shaped positions (2+1).

---

### 4.2.6 Horse — 馬 / 駿

**Base value:** 320 | **Promoted value:** 430

**Base movement:**
- Jumps in **L-shape** like a chess knight (2+1 or 1+2).
- Requires that at least **one of the two access routes** is clear:
  - **Route A:** Two squares in the primary direction.
  - **Route B:** Two squares in the secondary direction.

**Promoted movement (駿):**
- **All 8 adjacent squares** (1 square in each direction).
- **Plus** the standard knight jump (8 L-shaped positions).

---

### 4.2.7 Cannon — 炮 / 熕

**Base value:** 450 | **Promoted value:** 540

**Base movement:**
- **Non-capture movement:** Moves in a straight orthogonal line (up, down, left, right) like a tower, but without capturing.
- **Capture:** Jumps over **exactly one** intermediate piece to capture an enemy piece beyond it.

**Promoted movement (熕):**
- **Vertical movement:** Moves freely vertically (up/down) like a tower.
- **Diagonal capture:** Jumps over a piece diagonally (↘/↖) to capture.

---

### 4.2.8 Tower — 塔 / 𨐌

**Base value:** 520 | **Promoted value:** 650

**Base movement:**
- Moves in a straight **orthogonal** line (up, down, left, right) without distance limit.
- Stops upon encountering another piece (can capture enemy).

**Promoted movement (𨐌):**
- Moves along the ↗/↙ diagonals and the ↑/↓ verticals.
- Changes from orthogonal to mixed diagonal axis.

**Reusable:** Yes (goes to reserve when captured).

---

### 4.2.9 Carriage — 輦

**Value:** 390

**Movement:**
- **Orthogonal:** Up to 4 squares in the 4 orthogonal directions.
- **Diagonal:** 1 square in the ↘ and ↖ diagonals.
- **Restriction:** Can only move within its **own side** of the board (does not cross the river).

---

### 4.2.10 Archer — 矢

**Value:** 450

**Movement:**
- **Extended jump:** In L-shape of 3+1 or 1+3 (like a horse but longer), only within its own side.
- **On the bank:** Can move 1 square forward (crossing to the other side of the river) and to the immediate front diagonals.

**Special mechanic — Ambush:**
- When the archer moves to the **riverbank**, it activates the ambush.
- Blocks 3 enemy squares (front, front-left, front-right on the other side).
- Can capture enemy pieces on those squares.

**Restriction:** Can only move within its own side of the board.

**Evaluation bonus:** +300 points when positioned on the bank.

---

### 4.2.11 Pawn — 兵 / 弩

**Base value:** 110 | **Promoted value (Crossbow):** 240

**Base movement:**
- **In own territory:**
  - Advances 1 square forward (jumps the river automatically).
  - Captures diagonally forward (1 square).
  - Captures sideways (left/right, 1 square).
- **In enemy territory:**
  - Advances 1 square forward.
  - Moves and captures sideways (left/right).
  - Captures diagonally forward.

**River jump:** The pawn automatically jumps the river row when advancing. If the destination square is the river row, it moves one square beyond.

**Promotion to Crossbow (弩):** Upon reaching the promotion zone (last 3 enemy rows), it can optionally upgrade to Crossbow.

---

### 4.2.12 Crossbow — 弩

**Value:** 240

**Movement:**
- **Forward:** 1 square (with river jump).
- **Diagonal:** 1 square in all 4 diagonals (with river jump).

**River jump:** If the destination square is the river row:
- If the river is empty → jumps to the other side.
- If the river has a blocking piece → cannot pass.

**Particularities:**
- Is reusable (goes to reserve when captured).
- Can be dropped **anywhere** on the board (not just on own side).

---

## 4.3 Piece Notation

The game uses its own algebraic notation system:

| Piece | Symbol | Promoted Symbol |
|-------|--------|-----------------|
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

### Notation Format

- **Normal move:** `KG7` (King to G7)
- **Capture:** `TxpH5` (Tower captures pawn on H5)
- **Promotion:** `pA1+` (Pawn to A1, promotes)
- **Reserve drop:** `T*E8` (Tower from reserve placed on E8)
- **Ambush:** `AE7>HxF5` (Archer to E7, captures horse on F5)
- **Checkmate:** `QxKG1#`
- **Palace mate:** `TF2##`
- **Stalemate:** `HG5^`
- **Draw by repetition:** `TF2=`
