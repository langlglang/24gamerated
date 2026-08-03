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

const p2 = (solvable: boolean): HandScoringContext => ({
  mode: 'p2',
  playerIds: ['alice', 'bob'],
  solvable,
  lockedOut: [],
});

const p3 = (solvable: boolean, lockedOut: string[] = []): HandScoringContext => ({
  mode: 'p3',
  playerIds: ['alice', 'bob', 'cara'],
  solvable,
  lockedOut,
});

const p4 = (solvable: boolean): HandScoringContext => ({
  mode: 'p4team',
  playerIds: ['alice', 'bob', 'cara', 'dan'],
  teamOf: { alice: 'A', bob: 'A', cara: 'B', dan: 'B' },
  solvable,
  lockedOut: [],
});

describe('2-player scoring', () => {
  it('pays the buzzer for a correct answer', () => {
    const r = resolveBuzz(p2(true), 'alice', true);
    expect(r.points).toEqual({ alice: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('pays the opponent for a failed buzz and ends the hand', () => {
    const r = resolveBuzz(p2(true), 'alice', false);
    expect(r.points).toEqual({ bob: 1 });
    expect(r.handEnds).toBe(true);
    expect(r.lockOut).toBeNull();
  });

  it('pays a correct no-solution call', () => {
    expect(resolveNoSolutionCall(p2(false), 'alice').points).toEqual({ alice: 1 });
  });

  it('pays the opponent for a wrong no-solution call', () => {
    expect(resolveNoSolutionCall(p2(true), 'alice').points).toEqual({ bob: 1 });
  });
});

describe('3-player scoring', () => {
  it('ends the hand on a correct buzz', () => {
    const r = resolveBuzz(p3(true), 'alice', true);
    expect(r.points).toEqual({ alice: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('locks out a failed buzzer and keeps the hand alive', () => {
    const r = resolveBuzz(p3(true), 'alice', false);
    expect(r.points).toEqual({});
    expect(r.handEnds).toBe(false);
    expect(r.lockOut).toBe('alice');
  });

  it('keeps the hand alive after a second failure', () => {
    const r = resolveBuzz(p3(true, ['alice']), 'bob', false);
    expect(r.handEnds).toBe(false);
    expect(r.lockOut).toBe('bob');
  });

  it('ends with no points once all three have failed', () => {
    const r = resolveBuzz(p3(true, ['alice', 'bob']), 'cara', false);
    expect(r.points).toEqual({});
    expect(r.handEnds).toBe(true);
    expect(r.lockOut).toBe('cara');
  });

  it('pays a correct no-solution call in full', () => {
    const r = resolveNoSolutionCall(p3(false), 'alice');
    expect(r.points).toEqual({ alice: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('splits 0.5 to each opponent for a wrong call when nobody has buzzed', () => {
    const r = resolveNoSolutionCall(p3(true), 'alice');
    expect(r.points).toEqual({ bob: 0.5, cara: 0.5 });
    expect(r.handEnds).toBe(true);
  });

  it('pays the uninvolved player 1 for a wrong call after one buzz-fail', () => {
    // alice already buzzed and failed; bob calls no-solution and is wrong;
    // cara neither buzzed nor called, so cara takes the point.
    const r = resolveNoSolutionCall(p3(true, ['alice']), 'bob');
    expect(r.points).toEqual({ cara: 1 });
    expect(r.handEnds).toBe(true);
  });

  it('still pays the caller for a right call after a buzz-fail', () => {
    const r = resolveNoSolutionCall(p3(false, ['alice']), 'bob');
    expect(r.points).toEqual({ bob: 1 });
  });

  it('pays nobody when the last player calls wrong and both others already failed', () => {
    // Not covered by the spec: there is no uninvolved third player left.
    const r = resolveNoSolutionCall(p3(true, ['alice', 'bob']), 'cara');
    expect(r.points).toEqual({});
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
  it('accumulates fractional points', () => {
    let scores = applyPoints({}, { bob: 0.5, cara: 0.5 });
    scores = applyPoints(scores, { bob: 0.5 });
    expect(scores).toEqual({ bob: 1, cara: 0.5 });
  });

  it('identifies leaders and ties', () => {
    expect(leaders({ a: 3, b: 1 })).toEqual(['a']);
    expect(leaders({ a: 3, b: 3, c: 1 }).sort()).toEqual(['a', 'b']);
    expect(needsTiebreak({ a: 3, b: 1 })).toBe(false);
    expect(needsTiebreak({ a: 3, b: 3 })).toBe(true);
  });
});
