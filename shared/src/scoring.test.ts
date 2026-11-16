import { describe, expect, it } from 'vitest';
import {
  applyPoints,
  leaders,
  needsTiebreak,
  resolveBuzz,
  resolveIdleTimeout,
  resolveNoSolutionCall,
  type HandScoringContext,
} from './scoring.js';

const ffa = (
  players: string[],
  solvable: boolean,
  lockedOut: string[] = [],
): HandScoringContext => ({ mode: 'ffa', playerIds: players, solvable, lockedOut });

const TWO = ['alice', 'bob'];
const FIVE = ['alice', 'bob', 'cara', 'dan', 'eve'];

const p4 = (solvable: boolean): HandScoringContext => ({
  mode: 'p4team',
  playerIds: ['alice', 'bob', 'cara', 'dan'],
  teamOf: { alice: 'A', bob: 'A', cara: 'B', dan: 'B' },
  solvable,
  lockedOut: [],
});


describe('free-for-all, two players (classic head to head)', () => {
  it('pays the buzzer for a correct answer', () => {
    const r = resolveBuzz(ffa(TWO, true), 'alice', true);
    expect(r.points).toEqual({ alice: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('gives the opponent the point on a failed buzz, solvable or not', () => {
    for (const solvable of [true, false]) {
      const r = resolveBuzz(ffa(TWO, solvable), 'alice', false);
      expect(r.points).toEqual({ bob: 1 });
      expect(r.handEnds).toBe(true);
    }
  });

  it('scores no-solution calls', () => {
    expect(resolveNoSolutionCall(ffa(TWO, false), 'alice').points).toEqual({ alice: 1 });
    expect(resolveNoSolutionCall(ffa(TWO, true), 'alice').points).toEqual({ bob: 1 });
  });
});

describe('free-for-all, many players', () => {
  it('pays only the buzzer for a correct answer', () => {
    const r = resolveBuzz(ffa(FIVE, true), 'cara', true);
    expect(r.points).toEqual({ cara: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('buzzing on a hand with no solution pays everyone still eligible and ends the hand', () => {
    // bob already burned his buzz this hand, so he is not eligible.
    const r = resolveBuzz(ffa(FIVE, false, ['bob']), 'alice', false);
    expect(r.points).toEqual({ cara: 1, dan: 1, eve: 1 });
    expect(r.handEnds).toBe(true);
    expect(r.lockOut).toBe('alice');
  });

  it('a failed buzz on a solvable hand locks the buzzer out and keeps the hand alive', () => {
    const r = resolveBuzz(ffa(FIVE, true), 'alice', false);
    expect(r.points).toEqual({});
    expect(r.handEnds).toBe(false);
    expect(r.lockOut).toBe('alice');
  });

  it('auto-awards the last eligible player once everyone else has failed', () => {
    const r = resolveBuzz(ffa(FIVE, true, ['alice', 'bob', 'cara']), 'dan', false);
    expect(r.points).toEqual({ eve: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('pays a correct no-solution call in full', () => {
    const r = resolveNoSolutionCall(ffa(FIVE, false, ['alice']), 'bob');
    expect(r.points).toEqual({ bob: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('a wrong no-solution call pays everyone else still eligible', () => {
    const r = resolveNoSolutionCall(ffa(FIVE, true, ['alice']), 'bob');
    expect(r.points).toEqual({ cara: 1, dan: 1, eve: 1 });
    expect(r.handEnds).toBe(true);
  });
});

describe('4-player team scoring', () => {
  it('credits the buzzer team', () => {
    expect(resolveBuzz(p4(true), 'alice', true).points).toEqual({ A: 1 });
  });

  it('credits the opposing team on a failed buzz and ends the hand', () => {
    const r = resolveBuzz(p4(true), 'cara', false);
    expect(r.points).toEqual({ A: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('credits teams for no-solution calls', () => {
    expect(resolveNoSolutionCall(p4(false), 'dan').points).toEqual({ B: 1 });
    expect(resolveNoSolutionCall(p4(true), 'dan').points).toEqual({ A: 1 });
  });
});

describe('idle timeout', () => {
  it('scores nothing and ends the hand', () => {
    const r = resolveIdleTimeout();
    expect(r.points).toEqual({});
    expect(r.handEnds).toBe(true);
  });
});

describe('scoreboard helpers', () => {
  it('accumulates points', () => {
    let scores = applyPoints({}, { bob: 1, cara: 1 });
    scores = applyPoints(scores, { bob: 1 });
    expect(scores).toEqual({ bob: 2, cara: 1 });
  });

  it('identifies leaders and ties', () => {
    expect(leaders({ a: 3, b: 1 })).toEqual(['a']);
    expect(leaders({ a: 3, b: 3, c: 1 }).sort()).toEqual(['a', 'b']);
    expect(needsTiebreak({ a: 3, b: 1 })).toBe(false);
    expect(needsTiebreak({ a: 3, b: 3 })).toBe(true);
  });
});
