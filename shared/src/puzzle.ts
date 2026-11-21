import type { Card, Suit } from './cards.js';
import { assertDailyKey, seededRandom, dailyNumber } from './daily.js';
import { equals, rational } from './rational.js';
import type { CombineStep, RuleSet } from './types.js';
import { applyCombine, tableFromCards } from './validator.js';

/**
 * Daily puzzle: one deal a day, the same for everyone. 5 cards Monday to
 * Thursday, 6 Friday to Sunday, combined with + − × ÷ (every card used once)
 * to hit a 3-digit target. Solved or not; time is the only measure.
 *
 * The target is picked by an exhaustive search over the deal so it is always
 * reachable and has only a handful of solutions — big enough to be fair,
 * small enough that nobody stumbles into it.
 */

export const PUZZLE_RULES: RuleSet = { fractions: true, negatives: true };
export const PUZZLE_TARGET_RANGE = { min: 100, max: 999 } as const;
/** Solve counts (expression trees, so a+b and b+a count twice) we accept. */
const WAYS_BANDS: readonly (readonly [number, number])[] = [
  [1, 12],
  [1, 30],
  [1, 200],
  // Last resort so generation never throws: any reachable 3-digit target.
  [1, Number.POSITIVE_INFINITY],
];
/** Faster than this is not a human solve; the server rejects it. */
export const MIN_SOLVE_MS = 3_000;
/** Longest time the curve will record (a day). */
export const MAX_SOLVE_MS = 24 * 60 * 60_000;

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

export interface DailyPuzzle {
  readonly day: string;
  readonly number: number;
  readonly cards: readonly Card[];
  readonly target: number;
  /** Server-side only: how many expression trees hit the target. */
  readonly ways: number;
}

/** 5 cards Mon–Thu, 6 Fri–Sun (UTC). Throws on an invalid day key. */
export function puzzleCardCount(day: string): 5 | 6 {
  assertDailyKey(day);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return weekday === 0 || weekday >= 5 ? 6 : 5;
}

// ------------------------------------------------------------ search

interface Reach {
  v: number;
  n: number;
}

const valueKey = (v: number) => Math.round(v * 1e6) / 1e6;

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/**
 * Every value reachable using ALL of `values`, with how many expression trees
 * reach it. Dynamic programming over subsets; fine for up to 6 cards.
 * Floating point is only used to choose a target — answers are checked
 * exactly with rationals in `checkPuzzleSolution`.
 */
export function reachableValues(values: readonly number[]): Map<number, Reach> {
  const n = values.length;
  const full = (1 << n) - 1;
  const memo: Map<number, Reach>[] = new Array(full + 1);
  for (let i = 0; i < n; i++) memo[1 << i] = new Map([[values[i]!, { v: values[i]!, n: 1 }]]);
  const masks = Array.from({ length: full + 1 }, (_, i) => i).sort((a, b) => popcount(a) - popcount(b));
  for (const m of masks) {
    if (popcount(m) < 2) continue;
    const out = new Map<number, Reach>();
    const low = m & -m;
    for (let a = (m - 1) & m; a > 0; a = (a - 1) & m) {
      if (!(a & low)) continue; // each unordered split once
      const b = m ^ a;
      for (const x of memo[a]!.values()) {
        for (const y of memo[b]!.values()) {
          const ways = x.n * y.n;
          const add = (v: number) => {
            if (!Number.isFinite(v) || Math.abs(v) > 1e7) return;
            const k = valueKey(v);
            const cur = out.get(k);
            if (cur) cur.n += ways;
            else out.set(k, { v, n: ways });
          };
          add(x.v + y.v);
          add(x.v * y.v);
          add(x.v - y.v);
          add(y.v - x.v);
          if (y.v !== 0) add(x.v / y.v);
          if (x.v !== 0) add(y.v / x.v);
        }
      }
    }
    memo[m] = out;
  }
  return memo[full]!;
}

/** Only the last few days are ever asked for (today, yesterday, tomorrow's warm-up). */
const CACHE_LIMIT = 3;
const cache = new Map<string, DailyPuzzle>();

function remember(day: string, puzzle: DailyPuzzle): void {
  cache.set(day, puzzle);
  while (cache.size > CACHE_LIMIT) {
    // Evict the oldest day (keys are ISO dates, so string order is date order).
    let oldest: string | null = null;
    for (const k of cache.keys()) if (oldest === null || k < oldest) oldest = k;
    cache.delete(oldest!);
  }
}

/**
 * The puzzle for a UTC day ("YYYY-MM-DD"). Deterministic; cached.
 * Throws a RangeError on an invalid day key (callers validate request input
 * with isDailyKey first; this is the backstop so 'garbage' never yields NaN).
 */
export function dailyPuzzle(day: string): DailyPuzzle {
  assertDailyKey(day);
  const hit = cache.get(day);
  if (hit) return hit;

  const random = seededRandom(`24-puzzle:${day}`);
  const count = puzzleCardCount(day);
  for (const [minWays, maxWays] of WAYS_BANDS) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const ranks = Array.from({ length: count }, () => 1 + Math.floor(random() * 13));
      const candidates = [...reachableValues(ranks).values()]
        .filter(
          (r) =>
            Number.isInteger(valueKey(r.v)) &&
            r.v >= PUZZLE_TARGET_RANGE.min &&
            r.v <= PUZZLE_TARGET_RANGE.max &&
            r.n >= minWays &&
            r.n <= maxWays,
        )
        .sort((a, b) => a.v - b.v); // stable order so the pick is deterministic
      if (candidates.length === 0) continue;
      const pick = candidates[Math.floor(random() * candidates.length)]!;
      const puzzle: DailyPuzzle = {
        day,
        number: dailyNumber(day),
        cards: ranks.map((rank, i) => ({ id: `p${i}`, rank, suit: SUITS[i % SUITS.length]! })),
        target: Math.round(pick.v),
        ways: pick.n,
      };
      remember(day, puzzle);
      return puzzle;
    }
  }
  throw new Error(`no puzzle found for ${day}`);
}

export type PuzzleCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid-step' | 'wrong-step-count' | 'not-target' };

/** Exact check: every card used once, each step legal, the last card equals the target. */
export function checkPuzzleSolution(puzzle: DailyPuzzle, steps: readonly CombineStep[]): PuzzleCheck {
  if (steps.length !== puzzle.cards.length - 1) return { ok: false, reason: 'wrong-step-count' };
  let table = tableFromCards(puzzle.cards);
  for (const [i, step] of steps.entries()) {
    const r = applyCombine(table, step, PUZZLE_RULES, i);
    if (!r.ok) return { ok: false, reason: 'invalid-step' };
    table = r.table;
  }
  const last = table[0];
  return table.length === 1 && last && equals(last.value, rational(puzzle.target))
    ? { ok: true }
    : { ok: false, reason: 'not-target' };
}

// ------------------------------------------------------------ API shapes

/** What the client gets. No solution count, no answer. */
export interface DailyPuzzleView {
  readonly day: string;
  readonly number: number;
  readonly cards: readonly Card[];
  readonly target: number;
  /**
   * Server-signed proof of when this copy of the puzzle was handed out
   * (HMAC over day + issue time). The client keeps the first one it got for
   * the day and sends it back with the solve; the server times the solve
   * from it. Opaque to the client.
   */
  readonly startTicket: string;
}

/** Body of POST /api/daily/solve. `timeMs` is informational only: the server measures the time. */
export interface DailySolveRequest {
  readonly day: string;
  readonly steps: readonly CombineStep[];
  readonly startTicket?: string | null;
  /** From POST /api/daily/guest-solve: fixes the finish time of a solve made before signing in. */
  readonly solveReceipt?: string | null;
  readonly timeMs?: number;
}

/**
 * POST /api/daily/guest-solve (no account) checks a guest's solve and stamps
 * when it happened. Posting the receipt after signing in records that time, so
 * the minutes spent on the sign-in form don't count.
 */
export interface DailyGuestSolveResponse {
  readonly timeMs: number;
  readonly solveReceipt: string;
}

/** Machine-readable reason on a refused daily solve, so a client knows whether retrying can help. */
export type DailySolveErrorCode =
  | 'closed' // not today's or yesterday's puzzle: permanent
  | 'bad-steps' // unreadable solution: permanent
  | 'not-target' // doesn't reach the target: permanent
  | 'no-start' // no recorded start and no valid ticket, so it cannot be timed: permanent
  | 'too-fast'; // server-measured time under MIN_SOLVE_MS: retrying later gives a longer time

export interface SolveTimeBucket {
  readonly fromMs: number;
  readonly toMs: number;
  readonly count: number;
}

export interface DailyStatsView {
  readonly day: string;
  readonly number: number;
  /** Everyone with a recorded solve today. */
  readonly solvers: number;
  readonly medianMs: number | null;
  readonly buckets: readonly SolveTimeBucket[];
  /**
   * Present when the request was signed in and that player has solved.
   * `fasterThanPct` is null when nobody else has solved yet (no one to be faster than).
   */
  readonly mine: { readonly timeMs: number; readonly fasterThanPct: number | null } | null;
}

/**
 * Bucket solve times for a smooth-looking curve. Bucket edges follow a log
 * scale, since solve times are long-tailed: 10 s and 20 s matter more than
 * 20 min and 20 min 10 s.
 */
export function bucketSolveTimes(times: readonly number[], bucketCount = 24): SolveTimeBucket[] {
  if (times.length === 0) return [];
  // A loop, not Math.min(...times): spreading ~100k values overflows the stack.
  let min = Infinity;
  let max = -Infinity;
  for (const t of times) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const lo = Math.max(MIN_SOLVE_MS, min);
  const hi = Math.max(lo * 1.5, max);
  const logLo = Math.log(lo);
  const step = (Math.log(hi) - logLo) / bucketCount;
  const edges = Array.from({ length: bucketCount + 1 }, (_, i) => Math.round(Math.exp(logLo + i * step)));
  const buckets = edges.slice(0, -1).map((from, i) => ({ fromMs: from, toMs: edges[i + 1]!, count: 0 }));
  // Place each time by the same rounded edges the buckets report: bucket i is
  // [fromMs, toMs); the last one also takes its upper edge (and anything the
  // rounding pushed past it), the first anything below it. The unrounded log
  // index used before could put a time exactly on an edge in the lower bucket.
  for (const t of times) {
    let i = 0;
    let j = bucketCount - 1;
    while (i < j) {
      // Largest i with edges[i] <= t.
      const mid = (i + j + 1) >> 1;
      if (edges[mid]! <= t) i = mid;
      else j = mid - 1;
    }
    buckets[i]!.count += 1;
  }
  return buckets;
}

/**
 * Share of other solvers you beat: strictly slower solves / all others.
 * `times` must include your own time. Null when there is nobody else to compare with.
 */
export function fasterThanPct(mine: number, times: readonly number[]): number | null {
  const others = times.length - 1;
  if (others <= 0) return null;
  const slower = times.filter((t) => t > mine).length;
  return Math.round((slower / others) * 100);
}

/** Share line. With no percentage (first solver, or no curve) the comparison is left out. */
export function puzzleShareText(puzzle: { number: number; target: number }, timeMs: number, pct: number | null): string {
  const s = Math.round(timeMs / 1000);
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `24 Daily #${puzzle.number} · ${puzzle.target} ✓ ${time}${pct === null ? '' : ` (faster than ${pct}%)`}\n24game.online`;
}
