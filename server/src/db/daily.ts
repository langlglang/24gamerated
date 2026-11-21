import { query, queryOne } from './pool.js';

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

export async function getDailySolveTime(userId: string, day: string): Promise<number | null> {
  const row = await queryOne<{ time_ms: number }>(
    `SELECT time_ms FROM daily_solves WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
  return row ? row.time_ms : null;
}

/**
 * Every solve time for a day, fastest first. Test accounts (@example.test)
 * are left out, same as the rated leaderboard.
 * TODO: at large scale, pre-aggregate (histogram per day) instead of loading every row.
 */
export async function dailySolveTimes(day: string): Promise<number[]> {
  const rows = await query<{ time_ms: number }>(
    `SELECT d.time_ms
       FROM daily_solves d
       JOIN users u ON u.id = d.user_id
      WHERE d.day = $1 AND u.email_lower NOT LIKE '%@example.test'
   ORDER BY d.time_ms`,
    [day],
  );
  return rows.map((r) => r.time_ms);
}
