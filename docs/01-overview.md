# 1. Overview — Wéigōng (圍宮)

## 1.1 Game Concept

Wéigōng (圍宮, "Palace Siege") is a turn-based strategy game for two players on a 13×13 board. It is inspired by Xiangqi (Chinese chess) but introduces original mechanics such as:

- **Central river** that divides the board and modifies the movement of certain pieces.
- **Palaces** at each end of the board with siege and curse mechanics.
- **Reserve system** where certain captured pieces can be reintroduced.
- **Optional promotion** when reaching enemy territory.
- **Archer ambush mode** on the riverbank.

---

## 1.2 The Board

```
     A  B  C  D  E  F  G  H  I  J  K  L  M
  1  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐  ← Black Territory
  2  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │  ← Black Palace (cols F-H, rows 1-3)
  3  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │
  4  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  5  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← Black Bank
  6  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  7  │~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│~~│  ← RIVER (row 7, index 6)
  8  │  │  │  │  │  │  │  │  │  │  │  │  │  │
  9  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← White Bank
 10  │  │  │  │  │  │  │  │  │  │  │  │  │  │
 11  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │  ← White Palace (cols F-H, rows 11-13)
 12  │  │  │  │  │  │▓▓│▓▓│▓▓│  │  │  │  │  │
 13  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘  ← White Territory
```

### Special Zones

| Zone | Location (indices) | Description |
|------|-------------------|-------------|
| **River** | Row 6 (`RIVER_ROW = 6`) | No piece can end its turn on this row. Some pieces jump the river automatically. |
| **Black Palace** | Rows 0-2, Columns 5-7 | Sacred zone of the black king. Subject to siege and curse mechanics. |
| **White Palace** | Rows 10-12, Columns 5-7 | Sacred zone of the white king. Same mechanics. |
| **Promotion Zone** | Last 3 rows of enemy territory | Promotable pieces can be upgraded upon reaching here. |
| **Bank** | Row before the river on each side | Special position for the archer (activates ambush). |

### Board Constants (`src/constants.js`)

```javascript
BOARD_SIZE       = 13    // Board dimension
RIVER_ROW        = 6     // River row
PALACE_COL_START = 5     // Palace start column
PALACE_COL_END   = 7     // Palace end column
```

---

## 1.3 Initial Setup

The initial board setup follows a symmetrical scheme:

### Black Side (top rows)

| Row | Contents |
|-----|----------|
| Row 0 (back) | Tower · Cannon · Horse · Priest · Elephant · General · **King** · Queen · Elephant · Priest · Horse · Cannon · Tower |
| Row 1 (middle) | — · Carriage · — · — · — · — · Archer · — · — · — · — · Carriage · — |
| Row 2 (front) | Pawn × 13 |

### White Side (bottom rows)

Mirror of the black side (row 12 is the white back rank, with horizontally inverted order).

---

## 1.4 Turn System

1. **White always plays first** (`state.turn` initializes as `SIDE.WHITE`).
2. Each turn, the active player can:
   - **Move** a piece of their color.
   - **Drop** a piece from their reserve onto a valid square.
3. After each move, the following are evaluated:
   - **Check** (`isKingInCheck`)
   - **Checkmate** (`checkmate`)
   - **Stalemate** (`stalemate`)
   - **Palace Mate** (`palacemate`)
   - **Draw by repetition** (triple position repetition)

---

## 1.5 Victory Conditions

| Condition | Description |
|-----------|-------------|
| **Checkmate** | The opponent's king is in check and has no legal moves. |
| **Palace Mate** | The king is trapped inside its own palace with enemy pieces inside and no possibility of escape or expelling the invaders. |
| **Stalemate** | The player has no legal moves but is not in check → draw. |
| **Triple Repetition** | The exact same position occurs 3 times → draw. |

---

## 1.6 Special Mechanics

### 1.6.1 Reserve and Drop System

When certain pieces are captured, they go to the captor's **reserve** (not removed from the game):

| Piece | Reusable | Notes |
|-------|----------|-------|
| Tower | ✓ | Goes to reserve when captured |
| General | ✓ | Goes to reserve when captured |
| Pawn | ✓ | Goes to reserve when captured |
| Crossbow | ✓ | Goes to reserve when captured |
| All others | ✗ | Permanently removed |

**Drop Rules:**
- Can only be placed on empty squares.
- Cannot be placed on the river row.
- The placed piece must be on the player's own side of the board (except the crossbow, which can be placed anywhere).
- Cannot be placed on squares protected by an enemy archer.
- After the drop, the player's own king must not be in check.

### 1.6.2 Promotion

Promotable pieces can optionally be upgraded upon reaching the **promotion zone** (last 3 rows of enemy territory):

| Piece | Base Symbol | Promoted Symbol | Promoted Name |
|-------|-------------|-----------------|---------------|
| Elephant | 象 | 毅 | Fortified Elephant |
| Priest | 仙 | 叡 | Enlightened Priest |
| Horse | 馬 | 駿 | Charger |
| Cannon | 炮 | 熕 | Heavy Cannon |
| Tower | 塔 | 𨐌 | Enhanced Tower |
| Pawn | 兵 | 弩 | Crossbow |

**Non-promotable pieces:** King, Queen, General, Carriage, Archer.

### 1.6.3 Archer Ambush

When an archer moves to the **riverbank** (bank row), it activates the **ambush** mechanic:

1. Enemy pieces on the 3 blocked squares (front, front-left, front-right on the opposite side of the river) are identified.
2. Possible outcomes:
   - **No victims:** Nothing happens.
   - **One victim:** Automatically captured.
   - **Multiple victims:** The player chooses which to capture; the others retreat if they can, or are also captured if they are blocked.

### 1.6.4 Palace Curse

If enemy pieces remain inside a player's palace for **3 consecutive turns**, the **palace curse** is activated:

- **Effect on the King:** Can only move in straight lines (orthogonal), loses diagonal movement.
- **Effect on the Queen:** Can only move diagonally, loses orthogonal movement.
- **Deactivation:** If all enemy pieces leave the palace, the curse is deactivated and counters are reset.

### 1.6.5 Palace Siege (Palace Taken)

If enemy pieces remain inside the palace for **3 turns with pressure**, the palace is considered "taken" (`palaceTaken`). This influences the AI evaluation and can lead to a palace mate.
