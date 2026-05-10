import { SIDE, opponent, isPalaceSquare, isRiverSquare, forwardDir, inBounds, BOARD_SIZE } from '../src/constants.js';

describe('Utils / Constants', () => {
  test('opponent retorna el bando contrario', () => {
    expect(opponent(SIDE.WHITE)).toBe(SIDE.BLACK);
    expect(opponent(SIDE.BLACK)).toBe(SIDE.WHITE);
  });

  test('isPalaceSquare detecta casillas de palacio correctamente', () => {
    expect(isPalaceSquare(0, 5, SIDE.BLACK)).toBe(true);
    expect(isPalaceSquare(2, 7, SIDE.BLACK)).toBe(true);
    expect(isPalaceSquare(3, 5, SIDE.BLACK)).toBe(false); // fuera de fila
    expect(isPalaceSquare(0, 4, SIDE.BLACK)).toBe(false); // fuera de columna

    expect(isPalaceSquare(10, 5, SIDE.WHITE)).toBe(true);
    expect(isPalaceSquare(12, 7, SIDE.WHITE)).toBe(true);
    expect(isPalaceSquare(9, 6, SIDE.WHITE)).toBe(false);
  });

  test('isRiverSquare solo es true para la fila del río', () => {
    expect(isRiverSquare(6)).toBe(true);
    expect(isRiverSquare(5)).toBe(false);
  });

  test('forwardDir da +1 para negro y -1 para blanco', () => {
    expect(forwardDir(SIDE.BLACK)).toBe(1);
    expect(forwardDir(SIDE.WHITE)).toBe(-1);
  });

  test('inBounds verifica límites del tablero', () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(12, 12)).toBe(true);
    expect(inBounds(-1, 5)).toBe(false);
    expect(inBounds(5, 13)).toBe(false);
  });
});