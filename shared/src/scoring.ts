import type { GameMode, TeamId } from './types.js';

/**
 * Scores are keyed by "score holder": a player id in 2P/3P/solo, a team id in
 * 4P. Fractional points are real (3-player wrong no-solution call pays 0.5 to
 * each opponent), so the score display must handle halves.
 */
export type ScoreKey = string;

export interface HandScoringContext {
  readonly mode: GameMode;
  readonly playerIds: readonly string[];
  /** Required for 4P. Maps player id -> team id. */
  readonly teamOf?: Readonly<Record<string, TeamId>>;
  /** Server-side solver verdict for the dealt cards under the active rules. */
  readonly solvable: boolean;
  /** Players who have already buzzed and failed this hand (3P lockout). */
  readonly lockedOut: readonly string[];
}

export interface HandResolution {
  readonly points: Readonly<Record<ScoreKey, number>>;
  readonly handEnds: boolean;
  /** Player to lock out for the rest of the hand (3P buzz-fail). */
  readonly lockOut: string | null;
  /** Short human-readable explanation for the result overlay. */
  readonly note: string;
}

function teamOf(ctx: HandScoringContext, playerId: string): TeamId {
  const team = ctx.teamOf?.[playerId];
  if (!team) throw new Error(`player ${playerId} has no team assignment`);
  return team;
}

function otherTeam(team: TeamId): TeamId {
  return team === 'A' ? 'B' : 'A';
}

function opponentsOf(ctx: HandScoringContext, playerId: string): string[] {
  return ctx.playerIds.filter((id) => id !== playerId);
}

/** Which score key a player's points land on, given the mode. */
export function scoreKeyFor(ctx: HandScoringContext, playerId: string): ScoreKey {
  return ctx.mode === 'p4team' ? teamOf(ctx, playerId) : playerId;
}

/**
 * Resolve a buzz attempt that has finished (correctly or not).
 *
 * 3-player is the only mode where a failed buzz does not end the hand: the
 * buzzer is locked out and the remaining players keep playing the same cards.
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

  if (ctx.mode === 'p2') {
    const opponent = opponentsOf(ctx, buzzerId)[0]!;
    return correct
      ? { points: { [buzzerId]: 1 }, handEnds: true, lockOut: null, note: 'Buzzer solved it' }
      : {
          points: { [opponent]: 1 },
          handEnds: true,
          lockOut: null,
          note: 'Failed buzz — point to opponent',
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

  // 3-player
  if (correct) {
    return { points: { [buzzerId]: 1 }, handEnds: true, lockOut: null, note: 'Buzzer solved it' };
  }

  // A failed buzz locks the buzzer out and the hand continues. Once two
  // players have failed, the hand ends immediately and the point goes to the
  // one who stayed out — they never have to buzz to collect it.
  const lockedAfter = new Set([...ctx.lockedOut, buzzerId]);
  const survivors = ctx.playerIds.filter((id) => !lockedAfter.has(id));

  if (survivors.length === 1) {
    const winner = survivors[0]!;
    return {
      points: { [winner]: 1 },
      handEnds: true,
      lockOut: buzzerId,
      note: 'Two failed buzzes — point to the player who stayed out',
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
 * Resolve a "no solution" call.
 *
 * The 3-player wrong-call payout depends on whether anyone has already burned
 * their buzz on this hand:
 *  - nobody has     -> the other two split the blame reward, 0.5 each
 *  - someone has    -> the single player who neither buzzed nor called takes 1
 *
 * See [resolveBuzz] for the matching rule on a second failed buzz.
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

  if (ctx.mode === 'p2') {
    const opponent = opponentsOf(ctx, callerId)[0]!;
    return callerWasRight
      ? {
          points: { [callerId]: 1 },
          handEnds: true,
          lockOut: null,
          note: 'Correct no-solution call',
        }
      : {
          points: { [opponent]: 1 },
          handEnds: true,
          lockOut: null,
          note: 'Wrong call — point to opponent',
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

  // 3-player
  if (callerWasRight) {
    return {
      points: { [callerId]: 1 },
      handEnds: true,
      lockOut: null,
      note: 'Correct no-solution call',
    };
  }

  if (ctx.lockedOut.length === 0) {
    const points: Record<string, number> = {};
    for (const id of opponentsOf(ctx, callerId)) points[id] = 0.5;
    return {
      points,
      handEnds: true,
      lockOut: null,
      note: 'Wrong call — 0.5 to each opponent',
    };
  }

  // Someone already buzzed and failed, so the reward goes to the player who
  // neither buzzed nor called. At most one player can be locked out when a
  // call happens — a second failed buzz ends the hand outright — so there is
  // always exactly one such player. The empty fallback is defensive only.
  const innocent = ctx.playerIds.filter(
    (id) => id !== callerId && !ctx.lockedOut.includes(id),
  );
  const beneficiary = innocent.length === 1 ? innocent[0]! : null;
  return {
    points: beneficiary ? { [beneficiary]: 1 } : {},
    handEnds: true,
    lockOut: null,
    note: beneficiary
      ? 'Wrong call — point to the player who stayed out'
      : 'Wrong call — no eligible player left to score',
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
  const next: Record<ScoreKey, number> = { ...scores };
  for (const [key, value] of Object.entries(points)) {
    next[key] = (next[key] ?? 0) + value;
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
