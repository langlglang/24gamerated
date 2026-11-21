import { query, queryOne } from './pool.js';

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface ChallengeRow {
  id: string;
  from_user: string;
  to_user: string;
  status: ChallengeStatus;
  room_code: string | null;
  created_at: Date;
  responded_at: Date | null;
}

export interface ChallengeView {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromRating: number;
  toUserId: string;
  toUsername: string;
  status: ChallengeStatus;
  roomCode: string | null;
  createdAt: string;
}

const VIEW_SELECT = `
  SELECT c.id, c.status, c.room_code, c.created_at,
         c.from_user, uf.username AS from_username, uf.rating AS from_rating,
         c.to_user,   ut.username AS to_username
    FROM challenges c
    JOIN users uf ON uf.id = c.from_user
    JOIN users ut ON ut.id = c.to_user
`;

interface RawView {
  id: string;
  status: ChallengeStatus;
  room_code: string | null;
  created_at: Date;
  from_user: string;
  from_username: string;
  from_rating: number;
  to_user: string;
  to_username: string;
}

function toView(row: RawView): ChallengeView {
  return {
    id: row.id,
    fromUserId: row.from_user,
    fromUsername: row.from_username,
    fromRating: row.from_rating,
    toUserId: row.to_user,
    toUsername: row.to_username,
    status: row.status,
    roomCode: row.room_code,
    createdAt: row.created_at.toISOString(),
  };
}

/** Unanswered challenges stop being answerable after this long. */
export const CHALLENGE_EXPIRY_MINUTES = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Challenge ids are uuids; anything else cannot name a challenge. */
export function isChallengeId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** SQL fragment: this pending challenge is past its expiry. `c.` aliased. */
const STALE = `created_at < now() - make_interval(mins => ${CHALLENGE_EXPIRY_MINUTES})`;

/**
 * Create a pending challenge. Re-sending to the same person while one is still
 * pending returns the existing challenge instead of stacking duplicates. A
 * partial unique index (migration 006) allows one pending row per pair, so
 * two sends racing each other still end up with one.
 */
export async function createChallenge(
  fromUserId: string,
  toUserId: string,
): Promise<ChallengeView> {
  // A stale pending row (not yet swept) would otherwise block a fresh one.
  await query(
    `UPDATE challenges SET status = 'expired', responded_at = now()
      WHERE from_user = $1 AND to_user = $2 AND status = 'pending' AND ${STALE}`,
    [fromUserId, toUserId],
  );

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO challenges (from_user, to_user) VALUES ($1, $2)
     ON CONFLICT (from_user, to_user) WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [fromUserId, toUserId],
  );

  const row = inserted
    ? await queryOne<RawView>(`${VIEW_SELECT} WHERE c.id = $1`, [inserted.id])
    : await queryOne<RawView>(
        `${VIEW_SELECT} WHERE c.from_user = $1 AND c.to_user = $2 AND c.status = 'pending'`,
        [fromUserId, toUserId],
      );
  if (!row) throw new Error('challenge vanished after insert');
  return toView(row);
}

export async function getChallenge(id: string): Promise<ChallengeView | null> {
  if (!isChallengeId(id)) return null;
  const row = await queryOne<RawView>(`${VIEW_SELECT} WHERE c.id = $1`, [id]);
  return row ? toView(row) : null;
}

/** Challenges waiting on this player's answer. */
export async function pendingFor(userId: string): Promise<ChallengeView[]> {
  const rows = await query<RawView>(
    `${VIEW_SELECT} WHERE c.to_user = $1 AND c.status = 'pending' AND NOT (c.${STALE})
      ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map(toView);
}

/** Challenges this player has sent and not yet had answered. */
export async function outgoingFor(userId: string): Promise<ChallengeView[]> {
  const rows = await query<RawView>(
    `${VIEW_SELECT} WHERE c.from_user = $1 AND c.status = 'pending' AND NOT (c.${STALE})
      ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map(toView);
}

/**
 * Mark a pending challenge expired if it is past its expiry. The sweeper only
 * runs every few minutes, so anything that answers a challenge checks this
 * first. Returns the expired challenge, or null if it was still fresh (or no
 * longer pending).
 */
export async function expireIfStale(id: string): Promise<ChallengeView | null> {
  if (!isChallengeId(id)) return null;
  const updated = await queryOne<{ id: string }>(
    `UPDATE challenges SET status = 'expired', responded_at = now()
      WHERE id = $1 AND status = 'pending' AND ${STALE}
      RETURNING id`,
    [id],
  );
  return updated ? getChallenge(id) : null;
}

/**
 * Move a challenge out of pending. Guarded on the current status being
 * 'pending' so only one of several racing answers wins.
 */
export async function resolveChallenge(
  id: string,
  status: Exclude<ChallengeStatus, 'pending' | 'accepted'>,
): Promise<ChallengeView | null> {
  if (!isChallengeId(id)) return null;
  const updated = await queryOne<{ id: string }>(
    `UPDATE challenges
        SET status = $2, responded_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [id, status],
  );
  if (!updated) return null;
  return getChallenge(id);
}

/**
 * Atomically claim a challenge for acceptance: pending, addressed to
 * `toUserId`, and not expired. Exactly one caller can win this, so a double
 * tap or two tabs accepting at once start at most one match. The match is
 * started only after this returns a row.
 */
export async function claimChallenge(id: string, toUserId: string): Promise<ChallengeView | null> {
  if (!isChallengeId(id)) return null;
  const updated = await queryOne<{ id: string }>(
    `UPDATE challenges
        SET status = 'accepted', responded_at = now()
      WHERE id = $1 AND to_user = $2 AND status = 'pending' AND NOT (${STALE})
      RETURNING id`,
    [id, toUserId],
  );
  return updated ? getChallenge(id) : null;
}

/** Record the room an accepted challenge started. */
export async function attachRoom(id: string, roomCode: string): Promise<ChallengeView | null> {
  await query(`UPDATE challenges SET room_code = $2 WHERE id = $1 AND status = 'accepted'`, [
    id,
    roomCode,
  ]);
  return getChallenge(id);
}

/**
 * A claimed challenge whose match could not start after all (someone became
 * busy or went offline in between). It is closed rather than left accepted
 * with no game behind it.
 */
export async function abandonClaim(
  id: string,
  status: 'cancelled' | 'expired',
): Promise<ChallengeView | null> {
  await query(
    `UPDATE challenges SET status = $2 WHERE id = $1 AND status = 'accepted' AND room_code IS NULL`,
    [id, status],
  );
  return getChallenge(id);
}

/** Sweep challenges nobody answered, so the inbox does not fill with stale ones. */
export async function expireOlderThan(minutes: number): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE challenges SET status = 'expired', responded_at = now()
      WHERE status = 'pending' AND created_at < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(minutes)],
  );
  return rows.length;
}
