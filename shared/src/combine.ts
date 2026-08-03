import { add, div, isInteger, isNegative, mul, sub, type Rational } from './rational.js';
import type { Op, RuleSet } from './types.js';

/**
 * Why a single combine is illegal.
 *  - `div-by-zero`  : always illegal, under every rule set
 *  - `non-integer`  : fractions OFF and the step produced a fraction
 *  - `negative`     : negatives OFF and the step produced a value below zero
 */
export type CombineError = 'div-by-zero' | 'non-integer' | 'negative';

export type CombineOutcome =
  | { readonly ok: true; readonly value: Rational }
  | { readonly ok: false; readonly error: CombineError };

/**
 * THE rule for whether one combine step is legal, and what it produces.
 *
 * Both the solver and the answer validator call this and nothing else, so
 * "hands the solver says are solvable" and "answers the validator accepts"
 * cannot drift apart. If this function changes, both change together.
 */
export function computeCombine(
  a: Rational,
  op: Op,
  b: Rational,
  rules: RuleSet,
): CombineOutcome {
  let value: Rational | null;
  switch (op) {
    case '+':
      value = add(a, b);
      break;
    case '-':
      value = sub(a, b);
      break;
    case '*':
      value = mul(a, b);
      break;
    case '/':
      value = div(a, b);
      break;
  }

  if (value === null) return { ok: false, error: 'div-by-zero' };
  if (!rules.fractions && !isInteger(value)) return { ok: false, error: 'non-integer' };
  if (!rules.negatives && isNegative(value)) return { ok: false, error: 'negative' };
  return { ok: true, value };
}

export function describeCombineError(error: CombineError): string {
  switch (error) {
    case 'div-by-zero':
      return 'Cannot divide by zero';
    case 'non-integer':
      return 'Fractions are off — that division is not exact';
    case 'negative':
      return 'Negatives are off — that result is below zero';
  }
}
