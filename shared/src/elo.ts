/**
 * Elo ratings for rated 1v1 play.
 *
 * Kept pure and dependency-free so it can be unit tested exhaustively and
 * reused by the server without dragging in database types. Ratings are stored
 * as integers; all rounding happens here, in one place.
 */

/** Everyone starts here. */
export const STARTING_RATING = 1200;

/** Below this many rated games a player's rating moves faster. */
export const PROVISIONAL_GAMES = 30;

export const K_PROVISIONAL = 40;
export const K_STANDARD = 24;
export const K_ELITE = 16;

/** Above this rating, ratings move more slowly to reduce churn at the top. */
export const ELITE_THRESHOLD = 2400;

/** Ratings never fall below this, so a losing streak cannot spiral forever. */
export const RATING_FLOOR = 100;

export interface RatedPlayer {
  readonly rating: number;
  /** Completed rated games. Drives the provisional K-factor. */
  readonly ratedGames: number;
}

/** 1 = win, 0.5 = draw, 0 = loss. Draws are possible in theory only. */
export type MatchScore = 0 | 0.5 | 1;

export function kFactor(player: RatedPlayer): number {
  if (player.ratedGames < PROVISIONAL_GAMES) return K_PROVISIONAL;
  if (player.rating >= ELITE_THRESHOLD) return K_ELITE;
  return K_STANDARD;
}

/**
 * Probability that `rating` beats `opponentRating`. A 400-point gap gives the
 * favourite roughly a 10:1 edge, which is what the 400 constant encodes.
 */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export interface RatingChange {
  readonly before: number;
  readonly after: number;
  /** Signed, already rounded. `after - before`. */
  readonly delta: number;
}

export interface RatedOutcome {
  readonly a: RatingChange;
  readonly b: RatingChange;
}

function changeFor(player: RatedPlayer, opponent: RatedPlayer, score: MatchScore): RatingChange {
  const expected = expectedScore(player.rating, opponent.rating);
  const raw = kFactor(player) * (score - expected);
  // Round away from zero so a decided game always moves the rating by at
  // least a point; rounding toward zero would make tiny edges score nothing.
  const delta = raw >= 0 ? Math.ceil(raw) : Math.floor(raw);
  const after = Math.max(RATING_FLOOR, player.rating + delta);
  return { before: player.rating, after, delta: after - player.rating };
}

/**
 * Both players' new ratings, computed from the ratings they held BEFORE the
 * match — never sequentially, which would let move order change the result.
 */
export function ratedOutcome(a: RatedPlayer, b: RatedPlayer, scoreA: MatchScore): RatedOutcome {
  const scoreB = (1 - scoreA) as MatchScore;
  return {
    a: changeFor(a, b, scoreA),
    b: changeFor(b, a, scoreB),
  };
}

/** "+18" / "−12" / "0" — sign always explicit, for the result screen. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

export function isProvisional(player: RatedPlayer): boolean {
  return player.ratedGames < PROVISIONAL_GAMES;
}
