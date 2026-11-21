import { describe, expect, it } from 'vitest';
import {
  compareDaily,
  dailyKey,
  dailyNumber,
  dealDaily,
  isDailyKey,
  isDailyRecordList,
  previousDailyKey,
  scoreDaily,
  type DailyHandRecord,
} from './daily.js';
import { HANDS_PER_MATCH } from './constants.js';
import { solveCards } from './solver.js';
import { DAILY_RULES } from './daily.js';

const KEY = '2026-11-17';

describe('daily deck', () => {
  it('is identical for the same day and different across days', () => {
    expect(dealDaily(KEY)).toEqual(dealDaily(KEY));
    expect(dealDaily(KEY)).not.toEqual(dealDaily('2026-11-18'));
  });

  it('is a full deck: 13 hands, 52 distinct cards', () => {
    const hands = dealDaily(KEY);
    expect(hands).toHaveLength(HANDS_PER_MATCH);
    expect(new Set(hands.flat().map((c) => c.id)).size).toBe(52);
  });

  it('numbers days from launch and validates keys', () => {
    expect(dailyNumber('2026-11-17')).toBe(1);
    expect(dailyNumber('2026-11-27')).toBe(11);
    expect(dailyKey(new Date('2026-11-17T23:59:59Z'))).toBe('2026-11-17');
    expect(previousDailyKey('2026-12-01')).toBe('2026-11-30');
    expect(isDailyKey('2026-11-17')).toBe(true);
    expect(isDailyKey('2026-02-30')).toBe(false);
    expect(isDailyKey('nope')).toBe(false);
  });
});

/** Records that solve every solvable hand and call the rest correctly. */
function perfectRecords(key: string): DailyHandRecord[] {
  return dealDaily(key).map((cards) => {
    const solved = solveCards(cards, DAILY_RULES);
    return solved.solvable
      ? { steps: solved.steps, noSolution: false, ms: 10_000 }
      : { steps: null, noSolution: true, ms: 5_000 };
  });
}

describe('daily scoring', () => {
  it('credits real solutions and correct no-solution calls', () => {
    const score = scoreDaily(KEY, perfectRecords(KEY));
    expect(score.correct).toBe(13);
    expect(score.hands.every(Boolean)).toBe(true);
  });

  it('rejects steps that do not make 24 and wrong no-solution calls', () => {
    const records = perfectRecords(KEY);
    const solvableIndex = dealDaily(KEY).findIndex((c) => solveCards(c, DAILY_RULES).solvable);
    const cards = dealDaily(KEY)[solvableIndex]!;
    records[solvableIndex] = {
      steps: [
        { aId: cards[0]!.id, op: '+', bId: cards[1]!.id },
        { aId: 'm1', op: '+', bId: cards[2]!.id },
        { aId: 'm2', op: '+', bId: cards[3]!.id },
      ],
      noSolution: false,
      ms: 1000,
    };
    const sum = cards.reduce((s, c) => s + c.rank, 0);
    const score = scoreDaily(KEY, records);
    expect(score.correct).toBe(sum === 24 ? 13 : 12);

    const wrongCall = perfectRecords(KEY);
    wrongCall[solvableIndex] = { steps: null, noSolution: true, ms: 1000 };
    expect(scoreDaily(KEY, wrongCall).correct).toBe(12);
  });

  it('caps and clamps per-hand time', () => {
    const records = perfectRecords(KEY).map((r) => ({ ...r, ms: 10_000_000 }));
    records[0] = { ...records[0]!, ms: -50 };
    expect(scoreDaily(KEY, records).timeMs).toBe(12 * 120_000);
  });

  it('ranks by hands right, then by time', () => {
    expect(compareDaily({ correct: 12, timeMs: 9e5 }, { correct: 11, timeMs: 1 })).toBeLessThan(0);
    expect(compareDaily({ correct: 12, timeMs: 100 }, { correct: 12, timeMs: 200 })).toBeLessThan(0);
    expect(compareDaily({ correct: 12, timeMs: 100 }, { correct: 12, timeMs: 100 })).toBe(0);
  });

  it('checks record shape from clients', () => {
    expect(isDailyRecordList(perfectRecords(KEY))).toBe(true);
    expect(isDailyRecordList(perfectRecords(KEY).slice(1))).toBe(false);
    const bad = perfectRecords(KEY) as unknown[];
    bad[0] = { steps: [{ aId: 'x', op: '^', bId: 'y' }], noSolution: false, ms: 1 };
    expect(isDailyRecordList(bad)).toBe(false);
  });
});
