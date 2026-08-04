import { PROVISIONAL_GAMES } from '@24game/shared';
import { query, queryOne } from './pool.js';

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  rating: number;
  rated_games: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: Date;
  last_seen_at: Date;
}

/** What we are willing to send to a client about any player. Never the email. */
export interface PublicUser {
  id: string;
  username: string;
  rating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  draws: number;
  provisional: boolean;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    rating: row.rating,
    ratedGames: row.rated_games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    provisional: row.rated_games < PROVISIONAL_GAMES,
  };
}

const COLUMNS = `id, email, username, password_hash, rating, rated_games, wins, losses, draws,
                 created_at, last_seen_at`;

/** Postgres unique-violation. Lets callers tell "taken" from a real failure. */
export const UNIQUE_VIOLATION = '23505';

export class DuplicateUserError extends Error {
  constructor(readonly field: 'email' | 'username') {
    super(`${field} already registered`);
  }
}

export async function createUser(
  email: string,
  username: string,
  passwordHash: string,
): Promise<UserRow> {
  try {
    const row = await queryOne<UserRow>(
      `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [email, username, passwordHash],
    );
    if (!row) throw new Error('insert returned no row');
    return row;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) {
      const constraint = (err as { constraint?: string }).constraint ?? '';
      throw new DuplicateUserError(constraint.includes('username') ? 'username' : 'email');
    }
    throw err;
  }
}

export function findById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
}

export function findByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE email_lower = lower($1)`, [email]);
}

export function findByUsername(username: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE username_lower = lower($1)`, [
    username,
  ]);
}

export async function touchLastSeen(id: string): Promise<void> {
  await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [id]);
}

export interface LeaderboardEntry extends PublicUser {
  rank: number;
}

/**
 * Ranked by rating. Provisional accounts are included but flagged, so a new
 * player who wins twice does not look like a genuine number one.
 */
export async function leaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  const rows = await query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE rated_games > 0
     ORDER BY rating DESC, rated_games DESC, username ASC LIMIT $1`,
    [limit],
  );
  return rows.map((row, i) => ({ ...toPublicUser(row), rank: i + 1 }));
}
