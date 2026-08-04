import { describe, expect, it } from 'vitest';
import {
  ELITE_THRESHOLD,
  K_ELITE,
  K_PROVISIONAL,
  K_STANDARD,
  PROVISIONAL_GAMES,
  RATING_FLOOR,
  STARTING_RATING,
  expectedScore,
  formatDelta,
  isProvisional,
  kFactor,
  ratedOutcome,
} from './elo.js';

const settled = (rating: number) => ({ rating, ratedGames: PROVISIONAL_GAMES + 10 });
const rookie = (rating: number) => ({ rating, ratedGames: 0 });

describe('expectedScore', () => {
  it('is exactly even for equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
  });

  it('gives a 400-point favourite about a 10:1 edge', () => {
    expect(expectedScore(1600, 1200)).toBeCloseTo(10 / 11, 5);
    expect(expectedScore(1200, 1600)).toBeCloseTo(1 / 11, 5);
  });

  it('is symmetric — the two expectations sum to 1', () => {
    for (const [a, b] of [
      [1000, 1500],
      [2400, 1837],
      [1200, 1201],
    ]) {
      expect(expectedScore(a!, b!) + expectedScore(b!, a!)).toBeCloseTo(1, 10);
    }
  });
});

describe('kFactor', () => {
  it('is fastest while provisional, regardless of rating', () => {
    expect(kFactor(rookie(1200))).toBe(K_PROVISIONAL);
    expect(kFactor(rookie(2600))).toBe(K_PROVISIONAL);
    expect(kFactor({ rating: 1200, ratedGames: PROVISIONAL_GAMES - 1 })).toBe(K_PROVISIONAL);
  });

  it('drops to standard once out of provisional', () => {
    expect(kFactor({ rating: 1200, ratedGames: PROVISIONAL_GAMES })).toBe(K_STANDARD);
  });

  it('slows further at the top', () => {
    expect(kFactor(settled(ELITE_THRESHOLD))).toBe(K_ELITE);
    expect(kFactor(settled(ELITE_THRESHOLD - 1))).toBe(K_STANDARD);
  });
});

describe('ratedOutcome', () => {
  it('is zero-sum for evenly matched settled players', () => {
    const { a, b } = ratedOutcome(settled(1200), settled(1200), 1);
    expect(a.delta).toBe(12); // K_STANDARD * 0.5
    expect(b.delta).toBe(-12);
    expect(a.delta + b.delta).toBe(0);
  });

  it('pays little for beating a much weaker player', () => {
    const { a, b } = ratedOutcome(settled(1800), settled(1200), 1);
    expect(a.delta).toBeGreaterThan(0);
    expect(a.delta).toBeLessThanOrEqual(3);
    expect(b.delta).toBeGreaterThanOrEqual(-3);
  });

  it('pays heavily for an upset', () => {
    const { a, b } = ratedOutcome(settled(1200), settled(1800), 1);
    expect(a.delta).toBeGreaterThan(20);
    expect(b.delta).toBeLessThan(-20);
  });

  it('always moves a decided game by at least one point', () => {
    // A 1000-point gap rounds to nearly nothing before the away-from-zero rule.
    const { a, b } = ratedOutcome(settled(2400), settled(1200), 1);
    expect(a.delta).toBeGreaterThanOrEqual(1);
    expect(b.delta).toBeLessThanOrEqual(-1);
  });

  it('computes both sides from pre-match ratings, not sequentially', () => {
    // Swapping which player is "a" must mirror the result exactly.
    const forward = ratedOutcome(settled(1450), settled(1300), 1);
    const reversed = ratedOutcome(settled(1300), settled(1450), 0);
    expect(forward.a.delta).toBe(reversed.b.delta);
    expect(forward.b.delta).toBe(reversed.a.delta);
  });

  it('moves provisional players faster than settled ones', () => {
    const green = ratedOutcome(rookie(1200), rookie(1200), 1);
    const veteran = ratedOutcome(settled(1200), settled(1200), 1);
    expect(green.a.delta).toBeGreaterThan(veteran.a.delta);
  });

  it('handles a draw as a wash between equals', () => {
    const { a, b } = ratedOutcome(settled(1200), settled(1200), 0.5);
    expect(a.delta).toBe(0);
    expect(b.delta).toBe(0);
  });

  it('pays the underdog for a draw', () => {
    const { a, b } = ratedOutcome(settled(1200), settled(1600), 0.5);
    expect(a.delta).toBeGreaterThan(0);
    expect(b.delta).toBeLessThan(0);
  });

  it('never drops a rating below the floor', () => {
    const { a } = ratedOutcome(settled(RATING_FLOOR), settled(2000), 0);
    expect(a.after).toBe(RATING_FLOOR);
    expect(a.delta).toBe(0);
  });

  it('keeps ratings as integers', () => {
    for (const [ra, rb] of [
      [1200, 1337],
      [999, 1001],
      [2400, 1150],
    ]) {
      const { a, b } = ratedOutcome(settled(ra!), settled(rb!), 1);
      expect(Number.isInteger(a.after)).toBe(true);
      expect(Number.isInteger(b.after)).toBe(true);
    }
  });

  it('keeps a long series of matches bounded and sane', () => {
    // Sanity check against runaway inflation: a stronger player beating a
    // weaker one repeatedly should converge, not climb forever.
    let a = settled(1200);
    let b = settled(1200);
    for (let i = 0; i < 200; i++) {
      const out = ratedOutcome(a, b, 1);
      a = { rating: out.a.after, ratedGames: a.ratedGames + 1 };
      b = { rating: out.b.after, ratedGames: b.ratedGames + 1 };
    }
    expect(a.rating).toBeLessThan(3000);
    expect(b.rating).toBeGreaterThanOrEqual(RATING_FLOOR);
  });
});

describe('helpers', () => {
  it('marks new accounts provisional', () => {
    expect(isProvisional({ rating: STARTING_RATING, ratedGames: 0 })).toBe(true);
    expect(isProvisional({ rating: STARTING_RATING, ratedGames: PROVISIONAL_GAMES })).toBe(false);
  });

  it('formats deltas with an explicit sign', () => {
    expect(formatDelta(18)).toBe('+18');
    expect(formatDelta(-12)).toBe('−12');
    expect(formatDelta(0)).toBe('0');
  });
});
