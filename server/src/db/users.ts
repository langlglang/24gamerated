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
 * example.test (RFC 2606-style reserved) is where test accounts live: the
 * smoke scripts register there. Matches a domain of example.test or any
 * subdomain of it, with or without a trailing dot, case-insensitively:
 * x@example.test, x@EXAMPLE.TEST, x@example.test., x@qa.example.test.
 * Not x@notexample.test or x@example.testing.com.
 *
 * One pattern, used both as a JS RegExp and as a Postgres POSIX regex, so the
 * two can never disagree.
 */
export const TEST_EMAIL_PATTERN = '@([^@]*\\.)?example\\.test\\.?$';

const TEST_EMAIL_REGEX = new RegExp(TEST_EMAIL_PATTERN, 'i');

/** True for a test account's email. */
export function isTestEmail(email: string): boolean {
  return TEST_EMAIL_REGEX.test(email.trim());
}

/**
 * SQL boolean expression: true when `column` holds a test account's email.
 * `column` is interpolated as-is, so only ever pass a trusted column name
 * (e.g. 'email_lower' or 'u.email_lower'), never user input. Use
 * `NOT ${testEmailSql('u.email_lower')}` to hide test accounts.
 */
export function testEmailSql(column: string): string {
  return `(${column} ~* '${TEST_EMAIL_PATTERN}')`;
}

/**
 * Standard competition ranking ("1224"): equal ratings share a rank, and the
 * next distinct rating skips the places they took. Expects rows sorted by
 * rating, highest first.
 */
export function competitionRanks(ratings: readonly number[]): number[] {
  const ranks: number[] = [];
  ratings.forEach((rating, i) => {
    ranks.push(i > 0 && rating === ratings[i - 1] ? ranks[i - 1]! : i + 1);
  });
  return ranks;
}

/**
 * Ranked by rating. Provisional accounts are included but flagged, so a new
 * player who wins twice does not look like a genuine number one. Tied ratings
 * share a rank; within a tie, more games played lists first.
 */
export async function leaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  const rows = await query<UserRow>(
    // Test accounts never show up on the public board.
    `SELECT ${COLUMNS} FROM users
      WHERE rated_games > 0 AND NOT ${testEmailSql('email_lower')}
     ORDER BY rating DESC, rated_games DESC, username ASC LIMIT $1`,
    [limit],
  );
  const ranks = competitionRanks(rows.map((row) => row.rating));
  return rows.map((row, i) => ({ ...toPublicUser(row), rank: ranks[i]! }));
}
