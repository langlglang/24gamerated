import { ratedOutcome, type MatchScore, type RatedOutcome } from '@24game/shared';
import { query, withTransaction } from './pool.js';

export type MatchKind = 'ranked' | 'challenge';

export interface RecordMatchInput {
  kind: MatchKind;
  playerAId: string;
  playerBId: string;
  scoreA: number;
  scoreB: number;
  wentToTiebreak: boolean;
  /** The player who left the match; they lose whatever the score. */
  forfeitedBy?: string | null;
}

export interface RecordedMatch {
  matchId: string;
  outcome: RatedOutcome;
  winnerId: string | null;
  usernameA: string;
  usernameB: string;
}

interface LockedRow {
  id: string;
  username: string;
  rating: number;
  rated_games: number;
}

/** Thrown when a player's account is gone by the time the match is recorded. */
export class MissingPlayerError extends Error {}

/**
 * Persist a finished rated match and move both ratings, atomically.
 *
 * Both user rows are locked (SELECT ... FOR UPDATE) inside the transaction and
 * the Elo change is computed from the ratings read under that lock, then
 * written. A player whose two matches finish at the same moment therefore has
 * them applied one after the other, each on top of the other's result; reading
 * ratings before the transaction (or at match start) and writing absolute
 * values would let the second write erase the first. Rows are locked in id
 * order so two transactions over the same pair cannot deadlock.
 */
export async function recordRatedMatch(input: RecordMatchInput): Promise<RecordedMatch> {
  const { kind, playerAId, playerBId, scoreA, scoreB, wentToTiebreak } = input;
  const forfeitedBy = input.forfeitedBy ?? null;
  if (forfeitedBy !== null && forfeitedBy !== playerAId && forfeitedBy !== playerBId) {
    throw new Error('forfeitedBy must be one of the two players');
  }
  // A forfeit is a loss for whoever left, even if they were ahead.
  const result: MatchScore =
    forfeitedBy === playerAId ? 0
    : forfeitedBy === playerBId ? 1
    : scoreA > scoreB ? 1
    : scoreA < scoreB ? 0
    : 0.5;
  const winnerId = result === 1 ? playerAId : result === 0 ? playerBId : null;

  return withTransaction(async (client) => {
    const locked = await client.query<LockedRow>(
      `SELECT id, username, rating, rated_games
         FROM users
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [[playerAId, playerBId]],
    );
    const playerA = locked.rows.find((r) => r.id === playerAId);
    const playerB = locked.rows.find((r) => r.id === playerBId);
    if (!playerA || !playerB) {
      throw new MissingPlayerError('a player vanished before the match could be recorded');
    }

    const outcome = ratedOutcome(
      { rating: playerA.rating, ratedGames: playerA.rated_games },
      { rating: playerB.rating, ratedGames: playerB.rated_games },
      result,
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO matches
         (kind, player_a, player_b, score_a, score_b, winner,
          rating_a_before, rating_b_before, rating_a_after, rating_b_after, went_to_tiebreak, forfeit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        kind,
        playerA.id,
        playerB.id,
        scoreA,
        scoreB,
        winnerId,
        outcome.a.before,
        outcome.b.before,
        outcome.a.after,
        outcome.b.after,
        wentToTiebreak,
        forfeitedBy !== null,
      ],
    );

    // `after` was computed from the rating read under this transaction's row
    // lock, so writing it as an absolute value cannot lose a concurrent update.
    const bump = async (userId: string, after: number, res: MatchScore) => {
      await client.query(
        `UPDATE users SET
           rating = $2,
           rated_games = rated_games + 1,
           wins   = wins   + $3,
           losses = losses + $4,
           draws  = draws  + $5
         WHERE id = $1`,
        [userId, after, res === 1 ? 1 : 0, res === 0 ? 1 : 0, res === 0.5 ? 1 : 0],
      );
    };

    await bump(playerA.id, outcome.a.after, result);
    await bump(playerB.id, outcome.b.after, (1 - result) as MatchScore);

    return {
      matchId: inserted.rows[0]!.id,
      outcome,
      winnerId,
      usernameA: playerA.username,
      usernameB: playerB.username,
    };
  });
}

export interface MatchHistoryRow {
  id: string;
  kind: MatchKind;
  playedAt: string;
  opponent: string;
  yourScore: number;
  theirScore: number;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  result: 'win' | 'loss' | 'draw';
  forfeit: boolean;
}

interface RawHistoryRow {
  id: string;
  kind: MatchKind;
  played_at: Date;
  opponent: string;
  your_score: string;
  their_score: string;
  rating_before: number;
  rating_after: number;
  winner: string | null;
  forfeit: boolean;
}

/** A player's recent rated games, most recent first. */
export async function matchHistory(userId: string, limit = 10): Promise<MatchHistoryRow[]> {
  // The player can be on either side of a match, so normalise both cases into
  // "you" and "them" here rather than making the client work it out.
  const rows = await query<RawHistoryRow>(
    `SELECT m.id, m.kind, m.played_at, m.winner, m.forfeit,
            CASE WHEN m.player_a = $1 THEN ub.username    ELSE ua.username    END AS opponent,
            CASE WHEN m.player_a = $1 THEN m.score_a       ELSE m.score_b       END AS your_score,
            CASE WHEN m.player_a = $1 THEN m.score_b       ELSE m.score_a       END AS their_score,
            CASE WHEN m.player_a = $1 THEN m.rating_a_before ELSE m.rating_b_before END AS rating_before,
            CASE WHEN m.player_a = $1 THEN m.rating_a_after  ELSE m.rating_b_after  END AS rating_after
       FROM matches m
       JOIN users ua ON ua.id = m.player_a
       JOIN users ub ON ub.id = m.player_b
      WHERE m.player_a = $1 OR m.player_b = $1
      ORDER BY m.played_at DESC
      LIMIT $2`,
    [userId, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    playedAt: r.played_at.toISOString(),
    opponent: r.opponent,
    // numeric comes back from pg as a string to avoid float loss.
    yourScore: Number(r.your_score),
    theirScore: Number(r.their_score),
    ratingBefore: r.rating_before,
    ratingAfter: r.rating_after,
    delta: r.rating_after - r.rating_before,
    result: r.winner === null ? 'draw' : r.winner === userId ? 'win' : 'loss',
    forfeit: r.forfeit,
  }));
}
