import { describe, expect, it } from 'vitest';
import {
  bucketSolveTimes,
  checkPuzzleSolution,
  dailyPuzzle,
  fasterThanPct,
  puzzleCardCount,
  puzzleShareText,
  reachableValues,
} from './puzzle.js';
import { tableFromCards } from './validator.js';

const DAYS = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 10, 20 + i)).toISOString().slice(0, 10));

describe('daily puzzle', () => {
  it('uses 5 cards Mon–Thu and 6 Fri–Sun', () => {
    expect(puzzleCardCount('2026-11-23')).toBe(5); // Monday
    expect(puzzleCardCount('2026-11-26')).toBe(5); // Thursday
    expect(puzzleCardCount('2026-11-27')).toBe(6); // Friday
    expect(puzzleCardCount('2026-11-29')).toBe(6); // Sunday
  });

  it('is deterministic per day and different across days', () => {
    const a = dailyPuzzle(DAYS[0]!);
    expect(dailyPuzzle(DAYS[0]!)).toEqual(a);
    expect(dailyPuzzle(DAYS[1]!).target === a.target && dailyPuzzle(DAYS[1]!).cards === a.cards).toBe(false);
  }, 30_000);

  it('always has a reachable 3-digit target with few solutions', () => {
    for (const day of DAYS) {
      const p = dailyPuzzle(day);
      expect(p.cards).toHaveLength(puzzleCardCount(day));
      expect(p.target).toBeGreaterThanOrEqual(100);
      expect(p.target).toBeLessThanOrEqual(999);
      expect(p.ways).toBeGreaterThan(0);
      const reach = reachableValues(p.cards.map((c) => c.rank));
      expect([...reach.values()].some((r) => Math.abs(r.v - p.target) < 1e-9)).toBe(true);
    }
  }, 60_000);
});

describe('checkPuzzleSolution', () => {
  // 10 4 2 8 1 -> 339 = 10 × (4 × 8 + 2) − 1
  const puzzle = {
    day: 'x', number: 1, target: 339, ways: 1,
    cards: [10, 4, 2, 8, 1].map((rank, i) => ({ id: `p${i}`, rank, suit: 'S' as const })),
  };
  it('accepts a correct solution', () => {
    expect(
      checkPuzzleSolution(puzzle, [
        { aId: 'p1', op: '*', bId: 'p3' }, // m1 = 32
        { aId: 'm1', op: '+', bId: 'p2' }, // m2 = 34
        { aId: 'p0', op: '*', bId: 'm2' }, // m3 = 340
        { aId: 'm3', op: '-', bId: 'p4' }, // m4 = 339
      ]),
    ).toEqual({ ok: true });
  });
  it('rejects wrong totals, unused cards and bad ids', () => {
    expect(checkPuzzleSolution(puzzle, [{ aId: 'p0', op: '+', bId: 'p1' }]).ok).toBe(false);
    expect(
      checkPuzzleSolution(puzzle, [
        { aId: 'p1', op: '*', bId: 'p3' },
        { aId: 'm1', op: '+', bId: 'p2' },
        { aId: 'p0', op: '*', bId: 'm2' },
        { aId: 'm3', op: '+', bId: 'p4' },
      ]),
    ).toEqual({ ok: false, reason: 'not-target' });
    expect(
      checkPuzzleSolution(puzzle, [
        { aId: 'p1', op: '*', bId: 'p1' },
        { aId: 'm1', op: '+', bId: 'p2' },
        { aId: 'p0', op: '*', bId: 'm2' },
        { aId: 'm3', op: '-', bId: 'p4' },
      ]).ok,
    ).toBe(false);
    expect(tableFromCards(puzzle.cards)).toHaveLength(5);
  });
});

describe('distribution helpers', () => {
  it('buckets every time exactly once', () => {
    const times = [3000, 4000, 9000, 60_000, 61_000, 600_000];
    const b = bucketSolveTimes(times, 10);
    expect(b).toHaveLength(10);
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(times.length);
    expect(bucketSolveTimes([])).toEqual([]);
  });
  it('puts a time exactly on a bucket edge in the bucket that starts there', () => {
    // Every reported edge, and one ms either side, must land in the bucket whose
    // [fromMs, toMs) contains it (the last bucket also owns its upper edge).
    for (const base of [
      [3000, 100_000],
      [3000, 86_400_000],
      [4321, 9876],
      [12_345, 3_600_000],
    ]) {
      const b = bucketSolveTimes(base);
      const probes = b.flatMap((x) => [x.fromMs - 1, x.fromMs, x.fromMs + 1, x.toMs - 1, x.toMs]);
      for (const t of probes) {
        if (t < b[0]!.fromMs || t > b[b.length - 1]!.toMs) continue;
        const withT = bucketSolveTimes([...base, t]);
        // Same min/max, so the same edges.
        expect(withT.map((x) => [x.fromMs, x.toMs])).toEqual(b.map((x) => [x.fromMs, x.toMs]));
        const placed = withT.findIndex((x, i) => x.count !== b[i]!.count);
        const bucket = withT[placed]!;
        const last = placed === withT.length - 1;
        expect(t >= bucket.fromMs && (t < bucket.toMs || (last && t === bucket.toMs))).toBe(true);
      }
    }
  });
  it('clamps times outside the edges into the end buckets', () => {
    const b = bucketSolveTimes([1000, 3000, 60_000], 6); // 1000 is below the 3 s floor
    expect(b[0]!.count).toBe(2);
    expect(b[5]!.count).toBe(1);
  });
  it('computes faster-than percent against the others', () => {
    // Nobody else solved: there is no percentage to show.
    expect(fasterThanPct(5000, [5000])).toBeNull();
    expect(fasterThanPct(5000, [])).toBeNull();
    expect(fasterThanPct(5000, [5000, 6000, 7000, 4000, 9000])).toBe(75);
    expect(fasterThanPct(9000, [5000, 9000])).toBe(0);
    // A test account comparing against exactly one real solver.
    expect(fasterThanPct(4000, [9000, 4000])).toBe(100);
  });
  it('leaves the percentage out of the share text when there is none', () => {
    expect(puzzleShareText({ number: 5, target: 321 }, 65_000, null)).toBe('24 Daily #5 · 321 ✓ 1:05\n24game.online');
    expect(puzzleShareText({ number: 5, target: 321 }, 65_000, 40)).toContain('(faster than 40%)');
  });
  it('rejects invalid day keys instead of producing NaN', () => {
    for (const bad of ['garbage', '2026-02-30', '2026-13-01', '']) {
      expect(() => dailyPuzzle(bad)).toThrow(RangeError);
      expect(() => puzzleCardCount(bad)).toThrow(RangeError);
    }
  });
});
