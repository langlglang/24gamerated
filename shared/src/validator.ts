import { rankLabel, type Card } from './cards.js';
import { computeCombine, type CombineError } from './combine.js';
import { REQUIRED_COMBINE_STEPS, TARGET_VALUE } from './constants.js';
import { equals, formatRational, rational, type Rational } from './rational.js';
import type { CombineStep, RuleSet, TableCard } from './types.js';

/** Ids for combine results are positional, never supplied by the client. */
export function derivedId(stepIndex: number): string {
  return `m${stepIndex + 1}`;
}

export function tableFromCards(cards: readonly Card[]): TableCard[] {
  return cards.map((card) => ({
    id: card.id,
    value: rational(card.rank),
    label: rankLabel(card.rank),
    derived: false,
    sourceIds: [],
  }));
}

/** Convenience for tests and the solver: bare values get ids c0, c1, ... */
export function tableFromValues(values: readonly number[]): TableCard[] {
  return values.map((value, i) => ({
    id: `c${i}`,
    value: rational(value),
    label: String(value),
    derived: false,
    sourceIds: [],
  }));
}

export type StepError =
  | CombineError
  /** An id that is not on the table — never dealt, or already consumed. */
  | 'unknown-card'
  /** Both operands referenced the same card. */
  | 'same-card';

export type ApplyResult =
  | { readonly ok: true; readonly table: TableCard[]; readonly produced: TableCard }
  | { readonly ok: false; readonly error: StepError };

/**
 * Apply one combine step to a table. The two operands are consumed and
 * replaced by a single new card holding the exact rational result.
 */
export function applyCombine(
  table: readonly TableCard[],
  step: CombineStep,
  rules: RuleSet,
  stepIndex: number,
): ApplyResult {
  if (step.aId === step.bId) return { ok: false, error: 'same-card' };

  const a = table.find((c) => c.id === step.aId);
  const b = table.find((c) => c.id === step.bId);
  if (!a || !b) return { ok: false, error: 'unknown-card' };

  const outcome = computeCombine(a.value, step.op, b.value, rules);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const produced: TableCard = {
    id: derivedId(stepIndex),
    value: outcome.value,
    label: formatRational(outcome.value),
    derived: true,
    sourceIds: [a.id, b.id],
  };

  const table2 = table.filter((c) => c.id !== a.id && c.id !== b.id);
  table2.push(produced);
  return { ok: true, table: table2, produced };
}

export type ValidationError =
  | StepError
  /** Not exactly 3 steps — the hand did not reduce 4 cards to 1. */
  | 'wrong-step-count'
  /** Reduced to one card, but it was not 24. */
  | 'not-24';

export type ValidationResult =
  | { readonly valid: true; readonly finalValue: Rational; readonly table: TableCard[] }
  | {
      readonly valid: false;
      readonly error: ValidationError;
      /** Index of the offending step, when the failure was a specific step. */
      readonly atStep?: number;
      readonly finalValue?: Rational;
    };

/**
 * Replay a full answer against the dealt cards. The server is the source of
 * truth: it re-runs this on submission regardless of what the client claimed.
 */
export function validateSteps(
  start: readonly TableCard[],
  steps: readonly CombineStep[],
  rules: RuleSet,
): ValidationResult {
  if (steps.length !== REQUIRED_COMBINE_STEPS) {
    return { valid: false, error: 'wrong-step-count' };
  }

  let table: TableCard[] = start.slice();
  for (const [i, step] of steps.entries()) {
    const result = applyCombine(table, step, rules, i);
    if (!result.ok) return { valid: false, error: result.error, atStep: i };
    table = result.table;
  }

  const last = table[0];
  if (table.length !== 1 || !last) {
    return { valid: false, error: 'wrong-step-count' };
  }
  if (!equals(last.value, rational(TARGET_VALUE))) {
    return { valid: false, error: 'not-24', finalValue: last.value };
  }
  return { valid: true, finalValue: last.value, table };
}

/** Same check, starting from dealt cards rather than a prepared table. */
export function validateAnswer(
  cards: readonly Card[],
  steps: readonly CombineStep[],
  rules: RuleSet,
): ValidationResult {
  return validateSteps(tableFromCards(cards), steps, rules);
}

export function describeValidationError(error: ValidationError): string {
  switch (error) {
    case 'unknown-card':
      return 'That card is not on the table';
    case 'same-card':
      return 'A card cannot be combined with itself';
    case 'wrong-step-count':
      return 'All four cards must be combined down to one';
    case 'not-24':
      return 'That does not equal 24';
    case 'div-by-zero':
      return 'Cannot divide by zero';
    case 'non-integer':
      return 'Fractions are off — that division is not exact';
    case 'negative':
      return 'Negatives are off — that result is below zero';
  }
}
