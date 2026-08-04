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

/**
 * Create a pending challenge. Re-sending to the same person while one is still
 * pending returns the existing challenge instead of stacking duplicates.
 */
export async function createChallenge(
  fromUserId: string,
  toUserId: string,
): Promise<ChallengeView> {
  const existing = await queryOne<RawView>(
    `${VIEW_SELECT} WHERE c.from_user = $1 AND c.to_user = $2 AND c.status = 'pending'`,
    [fromUserId, toUserId],
  );
  if (existing) return toView(existing);

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO challenges (from_user, to_user) VALUES ($1, $2) RETURNING id`,
    [fromUserId, toUserId],
  );
  if (!inserted) throw new Error('challenge insert returned no row');

  const row = await queryOne<RawView>(`${VIEW_SELECT} WHERE c.id = $1`, [inserted.id]);
  if (!row) throw new Error('challenge vanished after insert');
  return toView(row);
}

export async function getChallenge(id: string): Promise<ChallengeView | null> {
  const row = await queryOne<RawView>(`${VIEW_SELECT} WHERE c.id = $1`, [id]);
  return row ? toView(row) : null;
}

/** Challenges waiting on this player's answer. */
export async function pendingFor(userId: string): Promise<ChallengeView[]> {
  const rows = await query<RawView>(
    `${VIEW_SELECT} WHERE c.to_user = $1 AND c.status = 'pending' ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map(toView);
}

/** Challenges this player has sent and not yet had answered. */
export async function outgoingFor(userId: string): Promise<ChallengeView[]> {
  const rows = await query<RawView>(
    `${VIEW_SELECT} WHERE c.from_user = $1 AND c.status = 'pending' ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map(toView);
}

/**
 * Move a challenge out of pending. Guarded on the current status being
 * 'pending' so a double-tap cannot accept the same challenge twice.
 */
export async function resolveChallenge(
  id: string,
  status: Exclude<ChallengeStatus, 'pending'>,
  roomCode: string | null = null,
): Promise<ChallengeView | null> {
  const updated = await queryOne<{ id: string }>(
    `UPDATE challenges
        SET status = $2, room_code = $3, responded_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [id, status, roomCode],
  );
  if (!updated) return null;
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
