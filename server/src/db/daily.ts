import { query, queryOne } from './pool.js';

export interface DailyResultRow {
  correct: number;
  time_ms: number;
  hands: boolean[];
}

/**
 * Store a player's result for a day. Returns null when they already have one:
 * the primary key makes the first submission the only one that counts.
 */
export async function saveDailyResult(
  userId: string,
  day: string,
  result: { correct: number; timeMs: number; hands: readonly boolean[] },
): Promise<DailyResultRow | null> {
  return queryOne<DailyResultRow>(
    `INSERT INTO daily_results (user_id, day, correct, time_ms, hands)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, day) DO NOTHING
       RETURNING correct, time_ms, hands`,
    [userId, day, result.correct, result.timeMs, JSON.stringify(result.hands)],
  );
}

export async function getDailyResult(userId: string, day: string): Promise<DailyResultRow | null> {
  return queryOne<DailyResultRow>(
    `SELECT correct, time_ms, hands FROM daily_results WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
}

export interface FriendDailyRow {
  id: string;
  username: string;
  correct: number | null;
  time_ms: number | null;
  hands: boolean[] | null;
  /** Head-to-head over every day you both played. Postgres counts arrive as strings. */
  wins: string;
  losses: string;
  ties: string;
}

/**
 * Everyone `userId` follows, with their result for `day` (null if they have not
 * played) and the all-time daily record between the two of you.
 */
export async function friendsDaily(userId: string, day: string): Promise<FriendDailyRow[]> {
  return query<FriendDailyRow>(
    `SELECT u.id, u.username,
            t.correct, t.time_ms, t.hands,
            h.wins, h.losses, h.ties
       FROM follows f
       JOIN users u ON u.id = f.followee
  LEFT JOIN daily_results t ON t.user_id = u.id AND t.day = $2
  LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE m.correct > o.correct
                                       OR (m.correct = o.correct AND m.time_ms < o.time_ms)) AS wins,
                   count(*) FILTER (WHERE m.correct < o.correct
                                       OR (m.correct = o.correct AND m.time_ms > o.time_ms)) AS losses,
                   count(*) FILTER (WHERE m.correct = o.correct AND m.time_ms = o.time_ms) AS ties
              FROM daily_results m
              JOIN daily_results o ON o.day = m.day AND o.user_id = u.id
             WHERE m.user_id = $1
            ) h ON true
      WHERE f.follower = $1
   ORDER BY lower(u.username)`,
    [userId, day],
  );
}

/** Returns false when the follow already existed. */
export async function follow(followerId: string, followeeId: string): Promise<boolean> {
  const row = await queryOne<{ follower: string }>(
    `INSERT INTO follows (follower, followee) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING follower`,
    [followerId, followeeId],
  );
  return row !== null;
}

export async function unfollow(followerId: string, followeeId: string): Promise<void> {
  await query(`DELETE FROM follows WHERE follower = $1 AND followee = $2`, [followerId, followeeId]);
}

export interface DailyLeaderboardRow {
  user_id: string;
  username: string;
  correct: number;
  time_ms: number;
}

/**
 * Today's best results: most hands right, then fastest, then first to finish.
 * Test accounts (@example.test) are left off, same as the rated leaderboard.
 */
export async function dailyLeaderboard(
  day: string,
  limit = 20,
): Promise<{ rows: DailyLeaderboardRow[]; players: number }> {
  const [rows, count] = await Promise.all([
    query<DailyLeaderboardRow>(
      `SELECT d.user_id, u.username, d.correct, d.time_ms
         FROM daily_results d
         JOIN users u ON u.id = d.user_id
        WHERE d.day = $1 AND u.email_lower NOT LIKE '%@example.test'
     ORDER BY d.correct DESC, d.time_ms ASC, d.created_at ASC
        LIMIT $2`,
      [day, limit],
    ),
    queryOne<{ n: string }>(
      `SELECT count(*) AS n
         FROM daily_results d
         JOIN users u ON u.id = d.user_id
        WHERE d.day = $1 AND u.email_lower NOT LIKE '%@example.test'`,
      [day],
    ),
  ]);
  return { rows, players: Number(count?.n ?? 0) };
}
