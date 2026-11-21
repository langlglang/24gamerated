import type { GameMode, TeamId } from './types.js';

/**
 * Scores are keyed by "score holder": a player id in free-for-all and solo, a
 * team id in 4P teams.
 */
export type ScoreKey = string;

/**
 * An empty score map with no prototype. Score keys are player ids, and an id
 * such as `__proto__` or `constructor` must be an ordinary key here rather
 * than reaching Object.prototype (assigning `__proto__` on a plain object
 * silently changes its prototype and the point is lost).
 */
export function emptyScores(): Record<ScoreKey, number> {
  return Object.create(null) as Record<ScoreKey, number>;
}

export interface HandScoringContext {
  readonly mode: GameMode;
  readonly playerIds: readonly string[];
  /** Required for 4P. Maps player id -> team id. */
  readonly teamOf?: Readonly<Record<string, TeamId>>;
  /** Server-side solver verdict for the dealt cards under the active rules. */
  readonly solvable: boolean;
  /** Players who have already buzzed and failed this hand (free-for-all lockout). */
  readonly lockedOut: readonly string[];
}

export interface HandResolution {
  readonly points: Readonly<Record<ScoreKey, number>>;
  readonly handEnds: boolean;
  /** Player to lock out for the rest of the hand (free-for-all buzz-fail). */
  readonly lockOut: string | null;
  /** Short human-readable explanation for the result overlay. */
  readonly note: string;
}

function teamOf(ctx: HandScoringContext, playerId: string): TeamId {
  const team =
    ctx.teamOf && Object.hasOwn(ctx.teamOf, playerId) ? ctx.teamOf[playerId] : undefined;
  if (team !== 'A' && team !== 'B') throw new Error(`player ${playerId} has no team assignment`);
  return team;
}

function otherTeam(team: TeamId): TeamId {
  return team === 'A' ? 'B' : 'A';
}

/** Everyone except `actorId` who has not burned their buzz this hand. */
function stillEligible(ctx: HandScoringContext, actorId: string): string[] {
  return ctx.playerIds.filter((id) => id !== actorId && !ctx.lockedOut.includes(id));
}

/** True for a two-player room, where "the other player" reads naturally. */
function headToHead(ctx: HandScoringContext): boolean {
  return ctx.playerIds.length === 2;
}

/** One point to each listed player. */
function pointEach(ids: readonly string[]): Record<ScoreKey, number> {
  const points = emptyScores();
  for (const id of ids) points[id] = 1;
  return points;
}

/** Which score key a player's points land on, given the mode. */
export function scoreKeyFor(ctx: HandScoringContext, playerId: string): ScoreKey {
  return ctx.mode === 'p4team' ? teamOf(ctx, playerId) : playerId;
}

/**
 * Resolve a buzz attempt that has finished (correctly or not).
 *
 * Free-for-all, any number of players:
 *  - correct                      -> buzzer +1, hand ends
 *  - failed, hand has no solution -> every other player still eligible to
 *                                    buzz gets +1, hand ends (the buzzer
 *                                    claimed a 24 that does not exist)
 *  - failed, hand is solvable     -> buzzer is locked out and the hand stays
 *                                    live for everyone else; once only one
 *                                    eligible player is left they take the
 *                                    point without having to buzz
 *
 * With two players both failure branches give the opponent the point, which
 * is the classic head-to-head rule.
 */
export function resolveBuzz(
  ctx: HandScoringContext,
  buzzerId: string,
  correct: boolean,
): HandResolution {
  if (ctx.mode === 'solo') {
    return {
      points: correct ? { [buzzerId]: 1 } : {},
      handEnds: true,
      lockOut: null,
      note: correct ? 'Solved' : 'Missed',
    };
  }

  if (ctx.mode === 'p4team') {
    const team = teamOf(ctx, buzzerId);
    return correct
      ? { points: { [team]: 1 }, handEnds: true, lockOut: null, note: `Team ${team} solved it` }
      : {
          points: { [otherTeam(team)]: 1 },
          handEnds: true,
          lockOut: null,
          note: `Failed buzz — point to team ${otherTeam(team)}`,
        };
  }

  if (correct) {
    return { points: { [buzzerId]: 1 }, handEnds: true, lockOut: null, note: 'Buzzer solved it' };
  }

  const others = stillEligible(ctx, buzzerId);

  if (!ctx.solvable) {
    return {
      points: pointEach(others),
      handEnds: true,
      lockOut: buzzerId,
      note:
        others.length === 1
          ? `No solution existed — point to ${headToHead(ctx) ? 'the other player' : 'the last player still in'}`
          : others.length > 1
            ? 'No solution existed — a point to everyone still in'
            : 'No solution existed — nobody left to score',
    };
  }

  if (others.length <= 1) {
    return {
      points: pointEach(others),
      handEnds: true,
      lockOut: buzzerId,
      note:
        others.length === 1
          ? 'Failed buzz — point to the last player still in'
          : 'Failed buzz — nobody left to score',
    };
  }

  return {
    points: {},
    handEnds: false,
    lockOut: buzzerId,
    note: 'Failed buzz — locked out, hand continues',
  };
}

/**
 * Resolve a "no solution" call. Right: caller +1. Wrong: every other player
 * still eligible to buzz gets +1, the mirror of buzzing on an impossible hand.
 */
export function resolveNoSolutionCall(
  ctx: HandScoringContext,
  callerId: string,
): HandResolution {
  const callerWasRight = !ctx.solvable;

  if (ctx.mode === 'solo') {
    return {
      points: callerWasRight ? { [callerId]: 1 } : {},
      handEnds: true,
      lockOut: null,
      note: callerWasRight ? 'Correct — no solution' : 'Wrong — this hand was solvable',
    };
  }

  if (ctx.mode === 'p4team') {
    const team = teamOf(ctx, callerId);
    return callerWasRight
      ? {
          points: { [team]: 1 },
          handEnds: true,
          lockOut: null,
          note: `Correct no-solution call — point to team ${team}`,
        }
      : {
          points: { [otherTeam(team)]: 1 },
          handEnds: true,
          lockOut: null,
          note: `Wrong call — point to team ${otherTeam(team)}`,
        };
  }

  if (callerWasRight) {
    return {
      points: { [callerId]: 1 },
      handEnds: true,
      lockOut: null,
      note: 'Correct no-solution call',
    };
  }

  const others = stillEligible(ctx, callerId);
  return {
    points: pointEach(others),
    handEnds: true,
    lockOut: null,
    note:
      others.length === 1
        ? `Wrong call — point to ${headToHead(ctx) ? 'the other player' : 'the last player still in'}`
        : others.length > 1
          ? 'Wrong call — a point to everyone still in'
          : 'Wrong call — nobody left to score',
  };
}

/** Nobody acted before the hand clock expired. */
export function resolveIdleTimeout(): HandResolution {
  return {
    points: {},
    handEnds: true,
    lockOut: null,
    note: 'Time up — nobody attempted this hand',
  };
}

/** Fold a resolution's points into a running scoreboard. */
export function applyPoints(
  scores: Readonly<Record<ScoreKey, number>>,
  points: Readonly<Record<ScoreKey, number>>,
): Record<ScoreKey, number> {
  const next = emptyScores();
  for (const [key, value] of Object.entries(scores)) next[key] = value;
  for (const [key, value] of Object.entries(points)) {
    next[key] = (Object.hasOwn(next, key) ? next[key]! : 0) + value;
  }
  return next;
}

/** Score keys tied for the lead, in no particular order. */
export function leaders(scores: Readonly<Record<ScoreKey, number>>): ScoreKey[] {
  const entries = Object.entries(scores);
  if (entries.length === 0) return [];
  const best = Math.max(...entries.map(([, v]) => v));
  return entries.filter(([, v]) => v === best).map(([k]) => k);
}

/** True when the match needs sudden-death hands to break a tie for the lead. */
export function needsTiebreak(scores: Readonly<Record<ScoreKey, number>>): boolean {
  return leaders(scores).length > 1;
}
