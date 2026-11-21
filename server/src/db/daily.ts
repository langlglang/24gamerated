import { query, queryOne } from './pool.js';
import { testEmailSql } from './users.js';

/**
 * Record a player's solve for a day. Returns false when they already had one:
 * the primary key makes the first solve the one that stands.
 */
export async function saveDailySolve(
  userId: string,
  day: string,
  timeMs: number,
  steps: unknown,
): Promise<boolean> {
  const row = await queryOne<{ user_id: string }>(
    `INSERT INTO daily_solves (user_id, day, time_ms, steps)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, day) DO NOTHING
       RETURNING user_id`,
    [userId, day, timeMs, JSON.stringify(steps)],
  );
  return row !== null;
}

/** The player's stored time for a day, plus whether they are a test account (left out of the pool). */
export async function getDailySolve(
  userId: string,
  day: string,
): Promise<{ timeMs: number; isTestAccount: boolean } | null> {
  const row = await queryOne<{ time_ms: number; is_test: boolean }>(
    `SELECT d.time_ms, ${testEmailSql('u.email_lower')} AS is_test
       FROM daily_solves d
       JOIN users u ON u.id = d.user_id
      WHERE d.user_id = $1 AND d.day = $2`,
    [userId, day],
  );
  return row ? { timeMs: row.time_ms, isTestAccount: row.is_test } : null;
}

/** Note when a signed-in player first opened a day's puzzle. Later opens keep the first time. */
export async function recordDailyStart(userId: string, day: string): Promise<void> {
  await query(
    `INSERT INTO daily_starts (user_id, day) VALUES ($1, $2) ON CONFLICT (user_id, day) DO NOTHING`,
    [userId, day],
  );
}

/** Milliseconds since the player first opened the day's puzzle, by the database clock; null if never recorded. */
export async function dailyElapsedMs(userId: string, day: string): Promise<number | null> {
  const row = await queryOne<{ elapsed_ms: string | number }>(
    `SELECT EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS elapsed_ms
       FROM daily_starts WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
  return row ? Math.round(Number(row.elapsed_ms)) : null;
}

/**
 * Every solve time for a day, fastest first. Test accounts (@example.test,
 * any subdomain of it, trailing dot allowed) are left out, same as the rated leaderboard.
 * TODO: at large scale, pre-aggregate (histogram per day) instead of loading every row.
 */
export async function dailySolveTimes(day: string): Promise<number[]> {
  const rows = await query<{ time_ms: number }>(
    `SELECT d.time_ms
       FROM daily_solves d
       JOIN users u ON u.id = d.user_id
      WHERE d.day = $1 AND NOT ${testEmailSql('u.email_lower')}
   ORDER BY d.time_ms`,
    [day],
  );
  return rows.map((r) => r.time_ms);
}
