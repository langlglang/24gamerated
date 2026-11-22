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

/**
 * Render a player's own combine steps as one readable expression, in the same
 * minimal-parentheses style as the solver. Display text only: correctness is
 * decided by `validateSteps`. Returns null if the steps do not reduce the
 * dealt cards to a single card.
 */
export function expressionForSteps(
  cards: readonly Card[],
  steps: readonly CombineStep[],
): string | null {
  const nodes = new Map<string, Node>();
  for (const card of tableFromCards(cards)) {
    nodes.set(card.id, { id: card.id, value: card.value, text: String(card.value.n), prec: LEAF_PRECEDENCE });
  }

  for (const [index, step] of steps.entries()) {
    const a = nodes.get(step.aId);
    const b = nodes.get(step.bId);
    if (!a || !b || a.id === b.id) return null;
    nodes.delete(a.id);
    nodes.delete(b.id);
    const id = derivedId(index);
    // value is never read when rendering, so carry the left operand's along.
    nodes.set(id, { id, value: a.value, text: renderCombine(a, step.op, b), prec: OP_PRECEDENCE[step.op] });
  }

  const [only, ...rest] = [...nodes.values()];
  return only && rest.length === 0 ? only.text : null;
}

/**
 * Canonical shape of an expression, so solutions that differ only in order
 * count once: a run of + and − is a sorted list of added and subtracted terms,
 * a run of × and ÷ a sorted list of multiplied and divided factors. So
 * "10 + 12 + 13 - 11" and "13 - 11 + 12 + 10" share a key.
 */
type Shape =
  | { kind: 'leaf'; key: string }
  | { kind: 'sum' | 'prod'; plus: Shape[]; minus: Shape[]; key: string };

function combineShape(a: Shape, op: Op, b: Shape): Shape {
  const kind = op === '+' || op === '-' ? 'sum' : 'prod';
  const plusOf = (x: Shape) => (x.kind === kind ? x.plus : [x]);
  const minusOf = (x: Shape) => (x.kind === kind ? x.minus : []);
  const inverse = op === '-' || op === '/';
  const plus = [...plusOf(a), ...(inverse ? minusOf(b) : plusOf(b))];
  const minus = [...minusOf(a), ...(inverse ? plusOf(b) : minusOf(b))];
  const sorted = (xs: Shape[]) => xs.map((x) => x.key).sort().join(',');
  const key = `${kind}(${sorted(plus)}|${sorted(minus)})`;
  return { kind, plus, minus, key };
}

/**
 * Every distinct way to make 24 from `values`, as readable expressions (the
 * public solver page). Same search as `solveTable`, but it keeps going after
 * the first hit. Solutions that are the same up to reordering terms or
 * factors are listed once, by their shortest text. Stops at `limit`.
 */
export function allSolutions(values: readonly number[], rules: RuleSet, limit = 100): string[] {
  const found = new Map<string, string>();
  type Item = Node & { shape: Shape };
  const walk = (nodes: readonly Item[]): void => {
    if (found.size >= limit) return;
    if (nodes.length === 1) {
      const only = nodes[0]!;
      if (!equals(only.value, rational(TARGET_VALUE))) return;
      const seen = found.get(only.shape.key);
      if (seen === undefined || only.text.length < seen.length) found.set(only.shape.key, only.text);
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const a = nodes[i]!;
        const b = nodes[j]!;
        for (const op of OPS) {
          if ((op === '+' || op === '*') && i > j) continue;
          const outcome = computeCombine(a.value, op, b.value, rules);
          if (!outcome.ok) continue;
          const rest = nodes.filter((_, k) => k !== i && k !== j);
          rest.push({
            id: '',
            value: outcome.value,
            text: renderCombine(a, op, b),
            prec: OP_PRECEDENCE[op],
            shape: combineShape(a.shape, op, b.shape),
          });
          walk(rest);
        }
      }
    }
  };
  walk(
    tableFromValues(values).map((card) => ({
      id: card.id,
      value: card.value,
      text: card.label,
      prec: LEAF_PRECEDENCE,
      shape: { kind: 'leaf' as const, key: card.label },
    })),
  );
  return [...found.values()];
}
