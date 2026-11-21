import { describe, expect, it } from 'vitest';
import { dailyKey, dailyNumber, formatDailyTime, isDailyKey, previousDailyKey, seededRandom } from './daily.js';

describe('daily keys', () => {
  it('numbers days from launch and validates keys', () => {
    expect(dailyNumber('2026-11-17')).toBe(1);
    expect(dailyNumber('2026-11-27')).toBe(11);
    expect(dailyKey(new Date('2026-11-17T23:59:59Z'))).toBe('2026-11-17');
    expect(previousDailyKey('2026-12-01')).toBe('2026-11-30');
    expect(isDailyKey('2026-11-17')).toBe(true);
    expect(isDailyKey('2026-02-30')).toBe(false);
    expect(isDailyKey('nope')).toBe(false);
  });

  it('seededRandom is deterministic per seed', () => {
    const a = seededRandom('x');
    const b = seededRandom('x');
    const c = seededRandom('y');
    const av = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(av);
    expect(c()).not.toBe(av[0]);
    expect(av.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('formats times as m:ss', () => {
    expect(formatDailyTime(0)).toBe('0:00');
    expect(formatDailyTime(65_400)).toBe('1:05');
  });
});
