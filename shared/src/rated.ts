import type { RuleSet } from './types.js';

/**
 * Rated play is deliberately narrow: 1v1 only, one fixed ruleset, one rating
 * pool. Ratings earned under different rules are not the same skill, so
 * allowing per-room rules would make the number meaningless.
 */
export const RATED_RULES: RuleSet = { fractions: true, negatives: true };

/** How rated seats get filled. */
export type RatedKind = 'ranked' | 'challenge';

/** A player as anyone is allowed to see them. Never includes an email. */
export interface PublicUserView {
  readonly id: string;
  readonly username: string;
  readonly rating: number;
  readonly ratedGames: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Still inside the provisional window, so the rating is not settled yet. */
  readonly provisional: boolean;
}

export interface LeaderboardEntryView extends PublicUserView {
  readonly rank: number;
}

export interface ChallengeView {
  readonly id: string;
  readonly fromUserId: string;
  readonly fromUsername: string;
  readonly fromRating: number;
  readonly toUserId: string;
  readonly toUsername: string;
  readonly status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  readonly roomCode: string | null;
  readonly createdAt: string;
}

export interface QueueStatusView {
  readonly inQueue: boolean;
  /** How long this player has been searching. */
  readonly waitingMs: number;
  /** Everyone currently searching, including this player. */
  readonly searching: number;
  /** Current rating band being searched, which widens the longer you wait. */
  readonly band: number;
}

export interface RatingChangeView {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/** Sent to each player once a rated match is recorded. */
export interface RatedResultView {
  readonly matchId: string;
  readonly kind: RatedKind;
  readonly result: 'win' | 'loss' | 'draw';
  readonly you: RatingChangeView;
  readonly opponent: RatingChangeView & { readonly username: string };
}

export interface MatchHistoryEntryView {
  readonly id: string;
  readonly kind: RatedKind;
  readonly playedAt: string;
  readonly opponent: string;
  readonly yourScore: number;
  readonly theirScore: number;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly delta: number;
  readonly result: 'win' | 'loss' | 'draw';
}

export type RatedRejection =
  | 'not-signed-in'
  | 'accounts-unavailable'
  | 'already-queued'
  | 'already-in-room'
  | 'user-not-found'
  | 'cannot-challenge-self'
  | 'challenge-not-found'
  | 'opponent-offline'
  | 'opponent-busy';

export const RATED_REJECTION_TEXT: Readonly<Record<RatedRejection, string>> = {
  'not-signed-in': 'Sign in to play rated games.',
  'accounts-unavailable': 'Rated play is not configured on this server.',
  'already-queued': 'You are already searching for a match.',
  'already-in-room': 'Leave your current game first.',
  'user-not-found': 'No player with that username.',
  'cannot-challenge-self': 'You cannot challenge yourself.',
  'challenge-not-found': 'That challenge is no longer available.',
  'opponent-offline': 'That player is not online right now.',
  'opponent-busy': 'That player is already in a game.',
};
