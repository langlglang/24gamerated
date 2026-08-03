/**
 * Exact rational arithmetic. The game never uses floating point for card
 * values or intermediate results: `8 / 3` must stay `8/3`, because rules like
 * "fractions OFF" and the final "equals exactly 24" check depend on exactness.
 */

export interface Rational {
  /** Numerator. Carries the sign. */
  readonly n: number;
  /** Denominator. Always > 0 and coprime with `n`. */
  readonly d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

/** Build a normalized rational. Throws on a zero or non-integer denominator. */
export function rational(n: number, d = 1): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`rational() requires integers, got ${n}/${d}`);
  }
  if (d === 0) throw new Error('rational() denominator must be non-zero');
  let num = n;
  let den = d;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

export const ZERO: Rational = { n: 0, d: 1 };
export const ONE: Rational = { n: 1, d: 1 };
export const TWENTY_FOUR: Rational = { n: 24, d: 1 };

export function add(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

/** Returns null for division by zero — always illegal, under every rule set. */
export function div(a: Rational, b: Rational): Rational | null {
  if (b.n === 0) return null;
  return rational(a.n * b.d, a.d * b.n);
}

export function isZero(r: Rational): boolean {
  return r.n === 0;
}

export function isNegative(r: Rational): boolean {
  return r.n < 0;
}

export function isInteger(r: Rational): boolean {
  return r.d === 1;
}

export function equals(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

/** Only for display/sorting. Never use the result in game logic. */
export function toNumber(r: Rational): number {
  return r.n / r.d;
}

/** "5", "8/3", "-5/3" — fractions stay fractions, never 2.6666666666666665. */
export function formatRational(r: Rational): string {
  return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`;
}
