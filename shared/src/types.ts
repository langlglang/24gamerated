import type { Rational } from './rational.js';

export type Op = '+' | '-' | '*' | '/';

export const OPS: readonly Op[] = ['+', '-', '*', '/'];

export const OP_SYMBOL: Readonly<Record<Op, string>> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
};

/**
 * The two independent rule toggles. They change which hands are solvable, so
 * any cached solver verdict is only valid for the rule set it was computed
 * under.
 */
export interface RuleSet {
  /** ON: intermediate results may be non-integers. OFF: every step must divide evenly. */
  readonly fractions: boolean;
  /** ON: intermediate results may go below zero. OFF: any negative result is illegal. */
  readonly negatives: boolean;
}

export const DEFAULT_RULES: RuleSet = { fractions: true, negatives: true };

/** All four combinations, handy for exhaustive tests. */
export const ALL_RULE_SETS: readonly RuleSet[] = [
  { fractions: true, negatives: true },
  { fractions: true, negatives: false },
  { fractions: false, negatives: true },
  { fractions: false, negatives: false },
];

export function describeRules(rules: RuleSet): string {
  return `fractions ${rules.fractions ? 'ON' : 'OFF'}, negatives ${
    rules.negatives ? 'ON' : 'OFF'
  }`;
}

/**
 * One move: combine two cards currently on the table. The id of the resulting
 * card is NOT client-supplied — it is derived from the step's index, so a
 * client cannot collide or forge ids.
 */
export interface CombineStep {
  readonly aId: string;
  readonly op: Op;
  readonly bId: string;
}

/** A card sitting on the table: either an original deal or a combine result. */
export interface TableCard {
  readonly id: string;
  readonly value: Rational;
  /** Display text: "K", "7", or "8/3" for a derived card. */
  readonly label: string;
  /** True once this card came from combining two others. */
  readonly derived: boolean;
  /** Ids of the two cards consumed to make this one (empty for originals). */
  readonly sourceIds: readonly string[];
}

/**
 * - `ffa`: free-for-all, any number of players from 2 up to the seat cap.
 * - `p4team`: exactly four players, 2 v 2.
 * - `solo`: training.
 */
export type GameMode = 'ffa' | 'p4team' | 'solo';

/** Largest free-for-all room. Keeps the scoreboard readable on a phone. */
export const MAX_FFA_PLAYERS = 10;

/** Inclusive seat range per mode. A match can start anywhere inside it. */
export const MODE_SEATS: Readonly<Record<GameMode, { readonly min: number; readonly max: number }>> = {
  ffa: { min: 2, max: MAX_FFA_PLAYERS },
  p4team: { min: 4, max: 4 },
  solo: { min: 1, max: 1 },
};

export type TeamId = 'A' | 'B';
