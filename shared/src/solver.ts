import type { Card } from './cards.js';
import { computeCombine } from './combine.js';
import { TARGET_VALUE } from './constants.js';
import { equals, rational, type Rational } from './rational.js';
import { OPS, type CombineStep, type Op, type RuleSet, type TableCard } from './types.js';
import { derivedId, tableFromCards, tableFromValues } from './validator.js';

/**
 * The solver enumerates COMBINE SEQUENCES, not expression strings.
 *
 * That matters: with negatives OFF or fractions OFF, legality is defined per
 * intermediate step, so "is this hand solvable" must mean "is there a legal
 * sequence of three combines ending at 24". Enumerating ordered pairs and
 * recursing covers every permutation, every operator assignment, and every
 * parenthesization shape, while checking each intermediate against the active
 * rules via the same `computeCombine` the validator uses.
 *
 * Search space is tiny (a few thousand leaves), so plain brute force is fine.
 */

interface Node {
  readonly id: string;
  readonly value: Rational;
  /** Human-readable expression built with minimal parentheses. */
  readonly text: string;
  /** Precedence of this node's top-level operator, for paren decisions. */
  readonly prec: number;
}

const OP_PRECEDENCE: Readonly<Record<Op, number>> = { '+': 1, '-': 1, '*': 2, '/': 2 };
const LEAF_PRECEDENCE = 3;

function renderCombine(a: Node, op: Op, b: Node): string {
  const prec = OP_PRECEDENCE[op];
  const left = a.prec < prec ? `(${a.text})` : a.text;
  // A right operand needs parens when it binds looser, or when it binds
  // equally under a non-associative operator: a - (b - c), a / (b / c).
  const rightNeedsParens = b.prec < prec || (b.prec === prec && (op === '-' || op === '/'));
  const right = rightNeedsParens ? `(${b.text})` : b.text;
  return `${left} ${op} ${right}`;
}

export interface SolveResult {
  readonly solvable: boolean;
  /** A readable solution, e.g. "8 / (3 - 8 / 3)". Null when unsolvable. */
  readonly expression: string | null;
  /** The same solution as replayable combine steps. Null when unsolvable. */
  readonly steps: readonly CombineStep[] | null;
}

const UNSOLVED: SolveResult = { solvable: false, expression: null, steps: null };

function search(nodes: readonly Node[], rules: RuleSet, steps: CombineStep[]): SolveResult | null {
  if (nodes.length === 1) {
    const only = nodes[0]!;
    if (equals(only.value, rational(TARGET_VALUE))) {
      return { solvable: true, expression: only.text, steps: steps.slice() };
    }
    return null;
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i]!;
      const b = nodes[j]!;
      for (const op of OPS) {
        // + and * are commutative, so only evaluate one ordering of each pair.
        if ((op === '+' || op === '*') && i > j) continue;

        const outcome = computeCombine(a.value, op, b.value, rules);
        if (!outcome.ok) continue;

        // The derived id must match what the validator assigns for this step
        // index, so a returned solution replays cleanly through validateSteps.
        const merged: Node = {
          id: derivedId(steps.length),
          value: outcome.value,
          text: renderCombine(a, op, b),
          prec: OP_PRECEDENCE[op],
        };
        const rest = nodes.filter((_, k) => k !== i && k !== j);
        rest.push(merged);

        steps.push({ aId: a.id, op, bId: b.id });
        const found = search(rest, rules, steps);
        if (found) return found;
        steps.pop();
      }
    }
  }
  return null;
}

export function solveTable(table: readonly TableCard[], rules: RuleSet): SolveResult {
  const nodes: Node[] = table.map((card) => ({
    id: card.id,
    value: card.value,
    text: card.label,
    prec: LEAF_PRECEDENCE,
  }));
  return search(nodes, rules, []) ?? UNSOLVED;
}

export function solveCards(cards: readonly Card[], rules: RuleSet): SolveResult {
  // Use raw ranks in the expression text: "11 + 13" reads better than "J + K"
  // when the point is the arithmetic.
  const table = tableFromCards(cards).map((c) => ({ ...c, label: String(c.value.n) }));
  return solveTable(table, rules);
}

export function solveValues(values: readonly number[], rules: RuleSet): SolveResult {
  return solveTable(tableFromValues(values), rules);
}

export function isSolvable(values: readonly number[], rules: RuleSet): boolean {
  return solveValues(values, rules).solvable;
}
