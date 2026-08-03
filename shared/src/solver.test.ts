import { describe, expect, it } from 'vitest';
import { equals, rational } from './rational.js';
import { isSolvable, solveValues } from './solver.js';
import { ALL_RULE_SETS, describeRules, type RuleSet } from './types.js';
import { tableFromValues, validateSteps } from './validator.js';

const FRAC_NEG: RuleSet = { fractions: true, negatives: true };
const FRAC_ONLY: RuleSet = { fractions: true, negatives: false };
const NEG_ONLY: RuleSet = { fractions: false, negatives: true };
const STRICT: RuleSet = { fractions: false, negatives: false };

/** Every distinct 4-card multiset from a 1..13 deck (1820 of them). */
function allHands(): number[][] {
  const hands: number[][] = [];
  for (let a = 1; a <= 13; a++)
    for (let b = a; b <= 13; b++)
      for (let c = b; c <= 13; c++) for (let d = c; d <= 13; d++) hands.push([a, b, c, d]);
  return hands;
}

/** Any solution the solver reports must survive the real validator. */
function expectSelfConsistent(values: number[], rules: RuleSet) {
  const result = solveValues(values, rules);
  if (!result.solvable) return;
  const check = validateSteps(tableFromValues(values), result.steps!, rules);
  expect(check.valid, `solver returned an answer the validator rejected: ${result.expression}`).toBe(
    true,
  );
}

describe('solver', () => {
  it('solves the trivial product hand under every rule set', () => {
    for (const rules of ALL_RULE_SETS) {
      const result = solveValues([4, 6, 1, 1], rules);
      expect(result.solvable, describeRules(rules)).toBe(true);
      expect(result.expression).toBeTruthy();
      expectSelfConsistent([4, 6, 1, 1], rules);
    }
  });

  it('finds 1 1 1 1 unsolvable under every rule set', () => {
    for (const rules of ALL_RULE_SETS) {
      const result = solveValues([1, 1, 1, 1], rules);
      expect(result.solvable, describeRules(rules)).toBe(false);
      expect(result.expression).toBeNull();
      expect(result.steps).toBeNull();
    }
  });

  describe('3 3 8 8 — the canonical fractions-required hand', () => {
    it('is solvable when fractions are ON', () => {
      expect(isSolvable([3, 3, 8, 8], FRAC_NEG)).toBe(true);
      expect(isSolvable([3, 3, 8, 8], FRAC_ONLY)).toBe(true);
    });

    it('is unsolvable when fractions are OFF', () => {
      // Its only route is 8 / (3 - 8/3), and 8/3 is not a legal intermediate.
      expect(isSolvable([3, 3, 8, 8], NEG_ONLY)).toBe(false);
      expect(isSolvable([3, 3, 8, 8], STRICT)).toBe(false);
    });

    it('produces a solution that replays through the validator', () => {
      expectSelfConsistent([3, 3, 8, 8], FRAC_NEG);
      const result = solveValues([3, 3, 8, 8], FRAC_NEG);
      const check = validateSteps(tableFromValues([3, 3, 8, 8]), result.steps!, FRAC_NEG);
      expect(check.valid).toBe(true);
      if (check.valid) expect(equals(check.finalValue, rational(24))).toBe(true);
    });
  });

  describe('fractions toggle', () => {
    it('flips exactly the 16 known fraction-required hands', () => {
      // Independent check on the solver: this set is a documented result for a
      // 1..13 deck, so any solver bug would almost certainly change the count.
      const flipped = allHands().filter(
        (hand) => isSolvable(hand, FRAC_NEG) && !isSolvable(hand, NEG_ONLY),
      );
      expect(flipped).toHaveLength(16);
      expect(flipped).toContainEqual([3, 3, 8, 8]);
      expect(flipped).toContainEqual([1, 5, 5, 5]);
      expect(flipped).toContainEqual([5, 7, 7, 11]);
    }, 30_000);
  });

  describe('negatives toggle', () => {
    /**
     * Empirically, for four cards drawn from 1..13, allowing negative
     * intermediates never makes an otherwise-unsolvable hand solvable — under
     * either fractions setting. Any hand reachable through a negative detour
     * is also reachable without one.
     *
     * The toggle is still meaningful in play: with negatives OFF the server
     * refuses negative combines, so a player cannot travel a route that dips
     * below zero. It just never changes the right answer to "no solution".
     */
    it('never changes whether a hand is solvable', () => {
      const flippedWithFractions = allHands().filter(
        (hand) => isSolvable(hand, FRAC_NEG) !== isSolvable(hand, FRAC_ONLY),
      );
      const flippedWithoutFractions = allHands().filter(
        (hand) => isSolvable(hand, NEG_ONLY) !== isSolvable(hand, STRICT),
      );
      expect(flippedWithFractions).toEqual([]);
      expect(flippedWithoutFractions).toEqual([]);
    }, 30_000);

    it('still blocks a negative route even though the hand stays solvable', () => {
      // 3 - 8 = -5 is illegal with negatives OFF...
      const viaNegative = validateSteps(
        tableFromValues([3, 8, 2, 2]),
        [
          { aId: 'c0', op: '-', bId: 'c1' },
          { aId: 'm1', op: '*', bId: 'c2' },
          { aId: 'm2', op: '*', bId: 'c3' },
        ],
        FRAC_ONLY,
      );
      expect(viaNegative.valid).toBe(false);
      // ...but the hand itself is still solvable by another route.
      expect(isSolvable([3, 8, 2, 2], FRAC_ONLY)).toBe(true);
    });

    it('never blocks a hand that has an all-positive route', () => {
      // 4 6 1 1 has 4*6*1*1, which never dips below zero.
      expect(isSolvable([4, 6, 1, 1], FRAC_ONLY)).toBe(true);
      expect(isSolvable([4, 6, 1, 1], STRICT)).toBe(true);
    });
  });

  it('is monotonic: loosening a rule never removes solvability', () => {
    for (let a = 1; a <= 13; a += 3)
      for (let b = a; b <= 13; b += 3)
        for (let c = b; c <= 13; c += 2)
          for (let d = c; d <= 13; d += 2) {
            const hand = [a, b, c, d];
            const strict = isSolvable(hand, STRICT);
            if (strict) {
              // Strictest rule set solvable => every looser one must be too.
              expect(isSolvable(hand, NEG_ONLY), `${hand}`).toBe(true);
              expect(isSolvable(hand, FRAC_ONLY), `${hand}`).toBe(true);
              expect(isSolvable(hand, FRAC_NEG), `${hand}`).toBe(true);
            }
          }
  });

  it('renders solutions with minimal parentheses', () => {
    const result = solveValues([6, 4, 1, 1], STRICT);
    expect(result.expression).not.toMatch(/^\(.*\)$/);
  });

  it('every solver answer is validator-clean across a deck sample', () => {
    for (const rules of ALL_RULE_SETS)
      for (let a = 1; a <= 13; a += 4)
        for (let b = 1; b <= 13; b += 4)
          for (let c = 1; c <= 13; c += 5)
            for (let d = 1; d <= 13; d += 5) expectSelfConsistent([a, b, c, d], rules);
  });
});
