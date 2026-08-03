import { describe, expect, it } from 'vitest';
import { equals, rational } from './rational.js';
import type { CombineStep, RuleSet } from './types.js';
import { applyCombine, tableFromValues, validateSteps } from './validator.js';

const LOOSE: RuleSet = { fractions: true, negatives: true };
const NO_FRACTIONS: RuleSet = { fractions: false, negatives: true };
const NO_NEGATIVES: RuleSet = { fractions: true, negatives: false };

const step = (aId: string, op: CombineStep['op'], bId: string): CombineStep => ({ aId, op, bId });

describe('validateSteps', () => {
  it('accepts a correct three-step answer', () => {
    const result = validateSteps(
      tableFromValues([4, 6, 1, 1]),
      [step('c0', '*', 'c1'), step('m1', '*', 'c2'), step('m2', '*', 'c3')],
      LOOSE,
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(equals(result.finalValue, rational(24))).toBe(true);
  });

  it('accepts the fractional route for 3 3 8 8', () => {
    // 8 / (3 - 8/3) = 24
    const result = validateSteps(
      tableFromValues([3, 3, 8, 8]),
      [step('c2', '/', 'c1'), step('c0', '-', 'm1'), step('c3', '/', 'm2')],
      LOOSE,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects that same route when fractions are OFF', () => {
    const result = validateSteps(
      tableFromValues([3, 3, 8, 8]),
      [step('c2', '/', 'c1'), step('c0', '-', 'm1'), step('c3', '/', 'm2')],
      NO_FRACTIONS,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('non-integer');
      expect(result.atStep).toBe(0);
    }
  });

  it('rejects a negative intermediate when negatives are OFF', () => {
    const result = validateSteps(
      tableFromValues([3, 8, 2, 2]),
      [step('c0', '-', 'c1'), step('m1', '*', 'c2'), step('m2', '*', 'c3')],
      NO_NEGATIVES,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('negative');
      expect(result.atStep).toBe(0);
    }
  });

  it('rejects division by zero under every rule set', () => {
    const result = validateSteps(
      tableFromValues([5, 5, 6, 4]),
      [step('c0', '-', 'c1'), step('c2', '/', 'm1'), step('m2', '*', 'c3')],
      LOOSE,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('div-by-zero');
      expect(result.atStep).toBe(1);
    }
  });

  it('rejects reuse of an already-consumed card', () => {
    const result = validateSteps(
      tableFromValues([4, 6, 1, 1]),
      [step('c0', '*', 'c1'), step('c0', '*', 'c2'), step('m2', '*', 'c3')],
      LOOSE,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('unknown-card');
      expect(result.atStep).toBe(1);
    }
  });

  it('rejects an unknown card id', () => {
    const result = validateSteps(
      tableFromValues([4, 6, 1, 1]),
      [step('c0', '*', 'nope'), step('m1', '*', 'c2'), step('m2', '*', 'c3')],
      LOOSE,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('unknown-card');
  });

  it('rejects combining a card with itself', () => {
    const result = validateSteps(
      tableFromValues([4, 6, 1, 1]),
      [step('c0', '*', 'c0'), step('m1', '*', 'c2'), step('m2', '*', 'c3')],
      LOOSE,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('same-card');
  });

  it('rejects too few steps', () => {
    const result = validateSteps(
      tableFromValues([4, 6, 1, 1]),
      [step('c0', '*', 'c1'), step('m1', '*', 'c2')],
      LOOSE,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('wrong-step-count');
  });

  it('rejects a complete but non-24 answer', () => {
    const result = validateSteps(
      tableFromValues([4, 6, 1, 1]),
      [step('c0', '+', 'c1'), step('m1', '+', 'c2'), step('m2', '+', 'c3')],
      LOOSE,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('not-24');
      expect(result.finalValue && equals(result.finalValue, rational(12))).toBe(true);
    }
  });
});

describe('applyCombine', () => {
  it('consumes both operands and appends the result', () => {
    const table = tableFromValues([3, 3, 8, 8]);
    const result = applyCombine(table, step('c2', '/', 'c1'), LOOSE, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.table.map((c) => c.id)).toEqual(['c0', 'c3', 'm1']);
      expect(result.produced.label).toBe('8/3');
      expect(result.produced.derived).toBe(true);
      expect(result.produced.sourceIds).toEqual(['c2', 'c1']);
    }
  });

  it('labels whole-number results without a denominator', () => {
    const result = applyCombine(tableFromValues([4, 6, 1, 1]), step('c0', '*', 'c1'), LOOSE, 0);
    expect(result.ok && result.produced.label).toBe('24');
  });

  it('leaves the table untouched when the step is illegal', () => {
    const table = tableFromValues([3, 8, 2, 2]);
    const result = applyCombine(table, step('c0', '-', 'c1'), NO_NEGATIVES, 0);
    expect(result.ok).toBe(false);
    expect(table.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });
});
