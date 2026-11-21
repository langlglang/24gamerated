import type { Card } from './cards.js';
import type {
  ChallengeView,
  PublicUserView,
  QueueStatusView,
  RatedKind,
  RatedRejection,
  RatedResultView,
} from './rated.js';
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
  /**
   * The solution shown after the hand: the solving player's own route when
   * someone solved it, otherwise one the solver found. Null when none exists.
   */
  readonly solution: string | null;
  /** Player id whose combine steps `solution` shows; null when it is the solver's. */
  readonly solvedBy: string | null;
  readonly pointsAwarded: Readonly<Record<ScoreKey, number>>;
  readonly note: string;
}

export interface MatchResultView {
  readonly scores: Readonly<Record<ScoreKey, number>>;
  readonly winners: readonly ScoreKey[];
  readonly wentToTiebreak: boolean;
}

/** Running tally across every match played in this room. */
export interface SeriesView {
  /** Matches won, by score key. */
  readonly wins: Readonly<Record<ScoreKey, number>>;
  readonly matchesPlayed: number;
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
  /** Survives across matches — the room keeps playing until everyone leaves. */
  readonly series: SeriesView;
  /** Rated rooms are 1v1, fixed-rules, single-match, and move Elo. */
  readonly rated: RatedKind | null;
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
  | 'player-offline'
  | 'invalid-combine';

/**
 * A successful create or join. `playerId` is public (it is in every state
 * broadcast); `reconnectToken` is a secret only this seat's owner receives.
 * Keep both, and send both back in `room:join` to reclaim the seat after a
 * refresh or a dropped connection.
 */
export interface SeatGrant {
  readonly ok: true;
  readonly roomCode: string;
  readonly playerId: string;
  readonly reconnectToken: string;
}

export interface ClientToServerEvents {
  /** Creating a room while seated elsewhere leaves the old seat first. */
  'room:create': (
    payload: { name: string; mode: GameMode; rules: RuleSet },
    ack: (res: SeatGrant | { ok: false; error: ActionRejection }) => void,
  ) => void;
  /**
   * Without `playerId` this takes a new seat (the server picks its id). With
   * `playerId` it reclaims that seat, which needs the seat's `reconnectToken`
   * (guest rooms) or a socket signed in as that user (rated rooms). Joining
   * while seated elsewhere leaves the old seat first.
   */
  'room:join': (
    payload: { name: string; roomCode: string; playerId?: string; reconnectToken?: string },
    ack: (res: SeatGrant | { ok: false; error: ActionRejection }) => void,
  ) => void;
  'room:configure': (payload: { mode?: GameMode; rules?: RuleSet }) => void;
  'room:setTeam': (payload: { playerId: string; team: TeamId }) => void;
  'room:start': () => void;
  'room:leave': () => void;
  'game:buzz': () => void;
  'game:callNoSolution': () => void;
  /** One combine step from the answering player. Server validates and echoes. */
  'game:combine': (payload: { step: CombineStep }) => void;
  /** Host starts another match in the same room, keeping the series tally. */
  'game:playAgain': () => void;

  // ---- rated play (all require a signed-in socket) ----

  /** Attach a signed-in identity to this socket. Also sent on reconnect. */
  'auth:identify': (
    payload: { token: string },
    ack: (res: { ok: true; user: PublicUserView } | { ok: false; error: RatedRejection }) => void,
  ) => void;
  'auth:signOut': () => void;
  'queue:join': (ack: (res: { ok: true } | { ok: false; error: RatedRejection }) => void) => void;
  'queue:leave': () => void;
  'challenge:send': (
    payload: { username: string },
    ack: (res: { ok: true; challenge: ChallengeView } | { ok: false; error: RatedRejection }) => void,
  ) => void;
  'challenge:respond': (
    payload: { id: string; accept: boolean },
    ack: (res: { ok: true } | { ok: false; error: RatedRejection }) => void,
  ) => void;
  'challenge:cancel': (payload: { id: string }) => void;
}

export interface ServerToClientEvents {
  state: (state: PublicGameState) => void;
  rejected: (payload: { action: string; reason: ActionRejection }) => void;
  /** An illegal combine attempt — client flashes the error, clock keeps running. */
  combineRejected: (payload: { error: ValidationError }) => void;
  roomClosed: (payload: { reason: string }) => void;
  /**
   * This socket's seat was reclaimed by another connection holding the same
   * seat credentials (normally the same player in a newer tab). The room is
   * still running; only this socket has been detached from it. Clear the
   * in-memory game state, but NOT the stored session: storage is shared with
   * the tab that now owns the seat.
   */
  seatReplaced: (payload: { roomCode: string }) => void;

  // ---- rated play ----

  /** The signed-in player's own record, refreshed after every rated match. */
  profile: (user: PublicUserView | null) => void;
  queueStatus: (status: QueueStatusView) => void;
  /** Matchmaker or an accepted challenge produced a game; the client joins it. */
  ratedMatchFound: (payload: {
    roomCode: string;
    /** Your seat in the room. Rated seats use your user id. */
    playerId: string;
    /**
     * The seat's reconnect secret, as for guest seats. Rated seats are
     * reclaimed by the signed-in owner (the token is not required there),
     * but it is issued so clients can store every seat the same way.
     */
    reconnectToken: string;
    kind: RatedKind;
    opponent: { username: string; rating: number };
  }) => void;
  /**
   * Rating movement, sent once the match has been recorded, and again to a
   * player who rejoins the finished rated room (e.g. after a refresh).
   */
  ratedResult: (result: RatedResultView) => void;
  challengeIncoming: (challenge: ChallengeView) => void;
  challengeUpdated: (challenge: ChallengeView) => void;
}
