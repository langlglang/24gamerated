import { ratedOutcome, type MatchScore, type RatedOutcome } from '@24game/shared';
import { query, withTransaction } from './pool.js';
import type { UserRow } from './users.js';

export type MatchKind = 'ranked' | 'challenge';

export interface RecordMatchInput {
  kind: MatchKind;
  playerA: UserRow;
  playerB: UserRow;
  scoreA: number;
  scoreB: number;
  wentToTiebreak: boolean;
}

export interface RecordedMatch {
  matchId: string;
  outcome: RatedOutcome;
  winnerId: string | null;
}

/**
 * Persist a finished rated match and move both ratings, atomically.
 *
 * Ratings are computed from the values read at match start (passed in as
 * UserRow), never re-read mid-write, so two matches finishing at once cannot
 * interleave into a wrong result for either player.
 */
export async function recordRatedMatch(input: RecordMatchInput): Promise<RecordedMatch> {
  const { kind, playerA, playerB, scoreA, scoreB, wentToTiebreak } = input;

  const result: MatchScore = scoreA > scoreB ? 1 : scoreA < scoreB ? 0 : 0.5;
  const outcome = ratedOutcome(
    { rating: playerA.rating, ratedGames: playerA.rated_games },
    { rating: playerB.rating, ratedGames: playerB.rated_games },
    result,
  );

  const winnerId = result === 1 ? playerA.id : result === 0 ? playerB.id : null;

  const matchId = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO matches
         (kind, player_a, player_b, score_a, score_b, winner,
          rating_a_before, rating_b_before, rating_a_after, rating_b_after, went_to_tiebreak)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
      ],
    );

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

    return inserted.rows[0]!.id;
  });

  return { matchId, outcome, winnerId };
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
}

/** A player's recent rated games, most recent first. */
export async function matchHistory(userId: string, limit = 10): Promise<MatchHistoryRow[]> {
  // The player can be on either side of a match, so normalise both cases into
  // "you" and "them" here rather than making the client work it out.
  const rows = await query<RawHistoryRow>(
    `SELECT m.id, m.kind, m.played_at, m.winner,
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
  }));
}
