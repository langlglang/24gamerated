import type { Card } from './cards.js';
import type { ScoreKey } from './scoring.js';
import type { CombineStep, GameMode, RuleSet, TableCard, TeamId } from './types.js';
import type { ValidationError } from './validator.js';

/** Where a room is in its lifecycle. Clients render purely from this. */
export type Phase =
  | 'lobby'
  | 'dealing'
  | 'open'
  | 'answering'
  | 'hand-result'
  | 'match-result'
  | 'paused';

export type TimerKind = 'buzz-start' | 'answer' | 'hand-idle' | 'result';

export interface TimerView {
  readonly kind: TimerKind;
  /** Server clock ms since epoch when this timer expires. */
  readonly endsAt: number;
  readonly durationMs: number;
  /** Server-computed remaining ms at broadcast time, for clock-skew safety. */
  readonly remainingMs: number;
}

export interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly team: TeamId | null;
  /** Buzzed and failed this hand — cannot act again until the next deal. */
  readonly lockedOut: boolean;
}

export interface HandResultView {
  readonly handNumber: number;
  readonly cards: readonly Card[];
  readonly solvable: boolean;
  /** A valid solution, revealed after the hand. Null when none exists. */
  readonly solution: string | null;
  readonly pointsAwarded: Readonly<Record<ScoreKey, number>>;
  readonly note: string;
}

export interface MatchResultView {
  readonly scores: Readonly<Record<ScoreKey, number>>;
  readonly winners: readonly ScoreKey[];
  readonly wentToTiebreak: boolean;
}

/**
 * Everything a client needs to render. Deliberately does NOT include the
 * solver verdict for the current hand — that would give away whether "no
 * solution" is the right call.
 */
export interface PublicGameState {
  readonly roomCode: string;
  readonly mode: GameMode;
  readonly rules: RuleSet;
  readonly phase: Phase;
  readonly hostId: string;
  readonly players: readonly PlayerView[];
  readonly scores: Readonly<Record<ScoreKey, number>>;
  readonly handNumber: number;
  readonly totalHands: number;
  readonly cardsRemaining: number;
  /** The four cards as dealt — clients need suits, which TableCard omits. */
  readonly cards: readonly Card[];
  /** Current table, including in-progress combines so spectators see them live. */
  readonly table: readonly TableCard[];
  /** Who is mid-answer, if anyone. */
  readonly activePlayerId: string | null;
  readonly timer: TimerView | null;
  readonly lastResult: HandResultView | null;
  readonly matchResult: MatchResultView | null;
  /** True during sudden-death hands after a tied 13. */
  readonly isTiebreak: boolean;
}

export type ActionRejection =
  | 'not-in-room'
  | 'not-host'
  | 'wrong-phase'
  | 'too-late'
  | 'locked-out'
  | 'not-your-turn'
  | 'room-full'
  | 'room-not-found'
  | 'name-taken'
  | 'wrong-player-count'
  | 'teams-unbalanced'
  | 'invalid-combine';

export interface ClientToServerEvents {
  'room:create': (
    payload: { name: string; mode: GameMode; rules: RuleSet },
    ack: (res: { ok: true; roomCode: string; playerId: string } | { ok: false; error: ActionRejection }) => void,
  ) => void;
  'room:join': (
    payload: { name: string; roomCode: string; playerId?: string },
    ack: (res: { ok: true; roomCode: string; playerId: string } | { ok: false; error: ActionRejection }) => void,
  ) => void;
  'room:configure': (payload: { mode?: GameMode; rules?: RuleSet }) => void;
  'room:setTeam': (payload: { playerId: string; team: TeamId }) => void;
  'room:start': () => void;
  'room:leave': () => void;
  'game:buzz': () => void;
  'game:callNoSolution': () => void;
  /** One combine step from the answering player. Server validates and echoes. */
  'game:combine': (payload: { step: CombineStep }) => void;
  'game:undo': () => void;
}

export interface ServerToClientEvents {
  state: (state: PublicGameState) => void;
  rejected: (payload: { action: string; reason: ActionRejection }) => void;
  /** An illegal combine attempt — client flashes the error, clock keeps running. */
  combineRejected: (payload: { error: ValidationError }) => void;
  roomClosed: (payload: { reason: string }) => void;
}
