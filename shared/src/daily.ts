import { dealMatch, type Card, type RandomFn } from './cards.js';
import { HANDS_PER_MATCH, HAND_IDLE_TIMEOUT_MS } from './constants.js';
import { solveCards } from './solver.js';
import { OPS, type CombineStep, type RuleSet } from './types.js';
import { tableFromCards, validateSteps } from './validator.js';

/**
 * Daily 24: one deck per UTC day, identical for every player, played solo and
 * compared afterwards (Wordle-style). The deck is derived from the date alone,
 * so client and server agree on it without the server sending any cards.
 */

/** Fixed for everyone so results are comparable. */
export const DAILY_RULES: RuleSet = { fractions: true, negatives: true };

/** Day #1. Changing this renumbers every past daily, so leave it. */
const DAILY_EPOCH_UTC = Date.UTC(2026, 10, 17);
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" in UTC, so the daily rolls over at the same instant worldwide. */
export function dailyKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function isDailyKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dailyKey(new Date(`${value}T00:00:00Z`)) === value;
}

/** The key for the day before `key`. */
export function previousDailyKey(key: string): string {
  return dailyKey(new Date(Date.parse(`${key}T00:00:00Z`) - DAY_MS));
}

/** 1-based puzzle number shown to players ("Daily #12"). */
export function dailyNumber(key: string): number {
  return Math.floor((Date.parse(`${key}T00:00:00Z`) - DAILY_EPOCH_UTC) / DAY_MS) + 1;
}

/** cyrb128-style string hash -> 32-bit seed. */
function hashSeed(text: string): number {
  let h1 = 1779033703;
  let h2 = 3144134277;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = Math.imul(h2 ^ k, 2869860233) ^ h1;
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return (h1 ^ (h1 >>> 16)) >>> 0;
}

/** mulberry32: small, fast, and deterministic across JS engines. */
export function seededRandom(seed: string): RandomFn {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 13 hands for a day. Same input, same deck, everywhere. */
export function dealDaily(key: string): Card[][] {
  return dealMatch(seededRandom(`24-daily:${key}`));
}

/** What a player did on one hand of the daily. */
export interface DailyHandRecord {
  /** Combine steps of a buzz that reached one card, or null. */
  readonly steps: readonly CombineStep[] | null;
  /** True when the player called "no solution" instead of buzzing. */
  readonly noSolution: boolean;
  /** Milliseconds from the deal to the end of the hand. */
  readonly ms: number;
}

export interface DailyScore {
  /** Hands solved, plus correct no-solution calls. 0..13. */
  readonly correct: number;
  /** Sum of per-hand time, each capped at the hand clock. Lower is better. */
  readonly timeMs: number;
  /** Per-hand verdicts, for the result grid. */
  readonly hands: readonly boolean[];
}

function isStep(value: unknown): value is CombineStep {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s['aId'] === 'string' &&
    typeof s['bId'] === 'string' &&
    typeof s['op'] === 'string' &&
    (OPS as readonly string[]).includes(s['op'])
  );
}

/** Shape check for records arriving from a client. */
export function isDailyRecordList(value: unknown): value is DailyHandRecord[] {
  if (!Array.isArray(value) || value.length !== HANDS_PER_MATCH) return false;
  return value.every((r) => {
    if (!r || typeof r !== 'object') return false;
    const rec = r as Record<string, unknown>;
    const stepsOk =
      rec['steps'] === null ||
      (Array.isArray(rec['steps']) && rec['steps'].length <= 3 && rec['steps'].every(isStep));
    return (
      stepsOk &&
      typeof rec['noSolution'] === 'boolean' &&
      typeof rec['ms'] === 'number' &&
      Number.isFinite(rec['ms'])
    );
  });
}

/**
 * Score a day from the player's records. Replays every buzz through the real
 * validator against the day's deck, so a client cannot claim a hand it did
 * not solve. Time is client-reported and only breaks ties.
 */
export function scoreDaily(key: string, records: readonly DailyHandRecord[]): DailyScore {
  const deck = dealDaily(key);
  const hands = deck.map((cards, i) => {
    const rec = records[i];
    if (!rec) return false;
    if (rec.steps) {
      return validateSteps(tableFromCards(cards), rec.steps, DAILY_RULES).valid;
    }
    return rec.noSolution && !solveCards(cards, DAILY_RULES).solvable;
  });
  const timeMs = records
    .slice(0, deck.length)
    .reduce((sum, r) => sum + Math.min(Math.max(Math.round(r.ms), 0), HAND_IDLE_TIMEOUT_MS), 0);
  return { correct: hands.filter(Boolean).length, timeMs, hands };
}

/** Negative when `a` beat `b`, positive when `b` won, 0 for a dead heat. */
export function compareDaily(
  a: { correct: number; timeMs: number },
  b: { correct: number; timeMs: number },
): number {
  if (a.correct !== b.correct) return b.correct - a.correct;
  return a.timeMs - b.timeMs;
}

/** A spoiler-free share line, e.g. "24 Daily #3 · 11/13 · 4:12". */
export function dailyShareText(key: string, score: DailyScore): string {
  const grid = score.hands.map((ok) => (ok ? '■' : '□')).join('');
  return `24 Daily #${dailyNumber(key)} · ${score.correct}/${score.hands.length} · ${formatDailyTime(score.timeMs)}\n${grid}`;
}

export function formatDailyTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ------------------------------------------------------------ API shapes

export interface DailyResultView {
  readonly correct: number;
  readonly timeMs: number;
  readonly hands: readonly boolean[];
}

export interface DailyFriendView {
  readonly userId: string;
  readonly username: string;
  readonly played: boolean;
  /** Their result. Withheld (null) until you have played today yourself. */
  readonly result: DailyResultView | null;
  /** Every day you have both played, from your side. */
  readonly record: { readonly wins: number; readonly losses: number; readonly ties: number };
}

export interface DailyTodayView {
  readonly day: string;
  readonly number: number;
  readonly mine: DailyResultView | null;
  readonly friends: readonly DailyFriendView[];
}

export interface DailyLeaderboardEntry {
  readonly rank: number;
  readonly userId: string;
  readonly username: string;
  readonly correct: number;
  readonly timeMs: number;
}

export interface DailyLeaderboardView {
  readonly day: string;
  readonly number: number;
  /** Everyone who has finished today's daily, not just the top of the list. */
  readonly players: number;
  readonly entries: readonly DailyLeaderboardEntry[];
}
