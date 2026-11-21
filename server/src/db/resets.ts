import { query, queryOne } from './pool.js';
import type { UserRow } from './users.js';

export async function createPasswordReset(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  // Only the newest link works: requesting again cancels the earlier ones.
  await query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [
    userId,
  ]);
  await query(
    `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, userId, expiresAt],
  );
}

/** Housekeeping: rows past their expiry are useless after a day. */
export async function pruneExpiredResets(): Promise<void> {
  await query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`);
}

/**
 * Spend a reset token and set the new password in one statement, so a token
 * can never be used twice even under concurrent requests. Any other links
 * still outstanding for the account are spent too. Returns the updated user,
 * or null when the token is unknown, expired, or already used.
 */
export async function consumePasswordReset(
  tokenHash: string,
  passwordHash: string,
): Promise<UserRow | null> {
  const user = await queryOne<UserRow>(
    `WITH spent AS (
        UPDATE password_resets
           SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id
     )
     UPDATE users u
        SET password_hash = $2
       FROM spent
      WHERE u.id = spent.user_id
  RETURNING u.id, u.email, u.username, u.password_hash, u.rating, u.rated_games,
            u.wins, u.losses, u.draws, u.created_at, u.last_seen_at`,
    [tokenHash, passwordHash],
  );
  if (user) {
    await query(
      `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
  }
  return user;
}
