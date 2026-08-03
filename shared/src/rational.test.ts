import { describe, expect, it } from 'vitest';
import {
  add,
  div,
  equals,
  formatRational,
  isInteger,
  isNegative,
  mul,
  rational,
  sub,
} from './rational.js';

describe('rational', () => {
  it('normalizes on construction', () => {
    expect(rational(4, 8)).toEqual({ n: 1, d: 2 });
    expect(rational(-4, 8)).toEqual({ n: -1, d: 2 });
    // A negative denominator moves its sign to the numerator.
    expect(rational(4, -8)).toEqual({ n: -1, d: 2 });
    expect(rational(0, 5)).toEqual({ n: 0, d: 1 });
  });

  it('rejects a zero denominator', () => {
    expect(() => rational(1, 0)).toThrow();
  });

  it('adds and subtracts exactly', () => {
    expect(add(rational(1, 3), rational(1, 6))).toEqual({ n: 1, d: 2 });
    expect(sub(rational(1, 3), rational(1, 2))).toEqual({ n: -1, d: 6 });
  });

  it('multiplies and divides exactly', () => {
    expect(mul(rational(2, 3), rational(3, 4))).toEqual({ n: 1, d: 2 });
    expect(div(rational(2, 3), rational(4, 9))).toEqual({ n: 3, d: 2 });
  });

  it('returns null rather than Infinity for division by zero', () => {
    expect(div(rational(5), rational(0))).toBeNull();
  });

  it('keeps 8 / 3 exact where floating point would not', () => {
    // 8/3 in floats is 2.6666666666666665; three thirds of it would not be 8.
    const third = div(rational(8), rational(3))!;
    const back = mul(third, rational(3));
    expect(equals(back, rational(8))).toBe(true);
    expect(isInteger(third)).toBe(false);
    expect(formatRational(third)).toBe('8/3');
  });

  it('reports sign and integrality', () => {
    expect(isNegative(rational(-1, 3))).toBe(true);
    expect(isNegative(rational(0))).toBe(false);
    expect(isInteger(rational(6, 3))).toBe(true);
  });

  it('formats negatives with the sign on the numerator', () => {
    expect(formatRational(rational(-5, 3))).toBe('-5/3');
    expect(formatRational(rational(24))).toBe('24');
  });
});
