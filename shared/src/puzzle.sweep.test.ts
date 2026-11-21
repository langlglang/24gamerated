import { describe, expect, it } from 'vitest';
import { dailyKey } from './daily.js';
import { bucketSolveTimes, dailyPuzzle, puzzleCardCount } from './puzzle.js';

describe('dailyPuzzle sweep', () => {
  it('generates a valid puzzle for every day for a year from launch (a one-off 3-year sweep passed in ~59 s, worst 470 ms)', () => {
    const start = Date.UTC(2026, 10, 17);
    let worst = 0;
    let worstDay = '';
    for (let i = 0; i < 366; i++) {
      const day = dailyKey(new Date(start + i * 86_400_000));
      const t0 = performance.now();
      const p = dailyPuzzle(day);
      const ms = performance.now() - t0;
      if (ms > worst) {
        worst = ms;
        worstDay = day;
      }
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      expect(p.cards).toHaveLength(weekday === 0 || weekday >= 5 ? 6 : 5);
      expect(p.cards).toHaveLength(puzzleCardCount(day));
      expect(p.target).toBeGreaterThanOrEqual(100);
      expect(p.target).toBeLessThanOrEqual(999);
    }
    console.log(`[sweep] worst-case dailyPuzzle: ${worst.toFixed(1)} ms on ${worstDay}`);
  }, 60_000);
});

describe('bucketSolveTimes at scale', () => {
  it('handles 200k unsorted times without overflowing the stack', () => {
    const times = Array.from({ length: 200_000 }, (_, i) => 3_000 + ((i * 7919) % 600_000));
    const b = bucketSolveTimes(times);
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(200_000);
  });
});
