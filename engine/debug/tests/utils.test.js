import { SIDE, opponent, isPalaceSquare, isRiverSquare, forwardDir, inBounds, BOARD_SIZE } from '../../constants.js';

describe('Utils / Constants', () => {
  test('opponent returns the opposite side', () => {
    expect(opponent(SIDE.WHITE)).toBe(SIDE.BLACK);
    expect(opponent(SIDE.BLACK)).toBe(SIDE.WHITE);
  });

  test('isPalaceSquare detects palace squares correctly', () => {
    expect(isPalaceSquare(0, 5, SIDE.BLACK)).toBe(true);
    expect(isPalaceSquare(2, 7, SIDE.BLACK)).toBe(true);
    expect(isPalaceSquare(3, 5, SIDE.BLACK)).toBe(false);
    expect(isPalaceSquare(0, 4, SIDE.BLACK)).toBe(false);

    expect(isPalaceSquare(10, 5, SIDE.WHITE)).toBe(true);
    expect(isPalaceSquare(12, 7, SIDE.WHITE)).toBe(true);
    expect(isPalaceSquare(9, 6, SIDE.WHITE)).toBe(false);
  });

  test('isRiverSquare is just ture for the river row', () => {
    expect(isRiverSquare(6)).toBe(true);
    expect(isRiverSquare(5)).toBe(false);
  });

  test('forwardDir gives +1 for black and -1 for white', () => {
    expect(forwardDir(SIDE.BLACK)).toBe(1);
    expect(forwardDir(SIDE.WHITE)).toBe(-1);
  });

  test('inBounds checks the board boundaries', () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(12, 12)).toBe(true);
    expect(inBounds(-1, 5)).toBe(false);
    expect(inBounds(5, 13)).toBe(false);
  });
});