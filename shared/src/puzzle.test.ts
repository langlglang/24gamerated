import { describe, expect, it } from 'vitest';
import {
  bucketSolveTimes,
  checkPuzzleSolution,
  dailyPuzzle,
  fasterThanPct,
  puzzleCardCount,
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
  it('computes faster-than percent against the others', () => {
    expect(fasterThanPct(5000, [5000])).toBe(100);
    expect(fasterThanPct(5000, [5000, 6000, 7000, 4000, 9000])).toBe(75);
    expect(fasterThanPct(9000, [5000, 9000])).toBe(0);
  });
});
