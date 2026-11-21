import type { RandomFn } from './cards.js';
import type { CombineStep } from './types.js';

/**
 * Daily date helpers: one puzzle per UTC day, identical for every player.
 * The puzzle itself lives in puzzle.ts.
 */

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

/**
 * What a player did on one hand of the old 13-hand daily. Still used by the
 * client's training mode; nothing on the server reads it.
 */
export interface DailyHandRecord {
  readonly steps: readonly CombineStep[] | null;
  readonly noSolution: boolean;
  readonly ms: number;
}

export function formatDailyTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
