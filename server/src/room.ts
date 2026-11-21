import {
  ANSWER_TIMEOUT_MS,
  BUZZ_START_TIMEOUT_MS,
  CARDS_PER_HAND,
  DEFAULT_RULES,
  HANDS_PER_MATCH,
  HAND_IDLE_TIMEOUT_MS,
  HAND_RESULT_DISPLAY_MS,
  MODE_SEATS,
  RECONNECT_GRACE_MS,
  applyPoints,
  buildDeck,
  dealMatch,
  emptyScores,
  expressionForSteps,
  leaders,
  needsTiebreak,
  resolveBuzz,
  resolveIdleTimeout,
  resolveNoSolutionCall,
  shuffle,
  solveCards,
  tableFromCards,
  validateSteps,
  type ActionRejection,
  type Card,
  type CombineStep,
  type GameMode,
  type HandResultView,
  type HandScoringContext,
  type MatchResultView,
  type Phase,
  type PlayerView,
  type PublicGameState,
  type RatedKind,
  type RuleSet,
  type ScoreKey,
  type SolveResult,
  type TableCard,
  type TeamId,
  type TimerKind,
  type ValidationError,
} from '@24game/shared';
import { applyCombine } from '@24game/shared';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface Player {
  id: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  team: TeamId | null;
  lockedOut: boolean;
}

interface ActiveTimer {
  kind: TimerKind;
  endsAt: number;
  durationMs: number;
  handle: NodeJS.Timeout;
}

export type RoomEvents = {
  /** Room state changed and should be pushed to everyone. */
  onChange: (room: Room) => void;
  /** A private message for one player (illegal combine feedback). */
  onCombineRejected: (room: Room, playerId: string, error: ValidationError) => void;
  /** Room is finished and should be torn down. */
  onClosed: (room: Room, reason: string) => void;
  /**
   * A rated match finished. Only fired for rated rooms; the handler persists
   * the result and moves both ratings.
   */
  onRatedMatchComplete?: (room: Room, result: RatedMatchOutcome) => void;
};

/** Everything the rating layer needs, with no database types leaking in here. */
export interface RatedMatchOutcome {
  kind: RatedKind;
  playerAId: string;
  playerBId: string;
  scoreA: number;
  scoreB: number;
  wentToTiebreak: boolean;
}

export type ActionResult = { ok: true } | { ok: false; error: ActionRejection };

export type SeatResult =
  | {
      ok: true;
      reconnectToken: string;
      /** A different socket that held this seat until now; the caller detaches it. */
      replacedSocketId: string | null;
    }
  | { ok: false; error: ActionRejection };

/** A per-seat secret. Player ids are public; this is what proves ownership. */
function newSeatToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Only the two known toggles are kept. Anything else a client tucks into
 * `rules` would otherwise be stored and re-broadcast in every state update.
 */
function cleanRules(rules: RuleSet): RuleSet {
  return { fractions: rules.fractions === true, negatives: rules.negatives === true };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Least hand time left to the others after a failed buzz. */
const HAND_RESUME_FLOOR_MS = 15_000;

const OK: ActionResult = { ok: true };
const fail = (error: ActionRejection): { ok: false; error: ActionRejection } => ({
  ok: false,
  error,
});

/**
 * One room's authoritative game state. Every rule that matters — the deck, the
 * solver verdict, buzz arbitration, timers, scoring — is decided here. Clients
 * only ever send intents.
 */
export class Room {
  readonly code: string;
  hostId: string;
  mode: GameMode = 'ffa';
  rules: RuleSet = { ...DEFAULT_RULES };
  players: Player[] = [];

  phase: Phase = 'lobby';
  scores: Record<ScoreKey, number> = emptyScores();
  /** playerId -> reconnect secret. Never broadcast. */
  private seatTokens = new Map<string, string>();

  /** Pre-dealt hands for the match, sliced from one shuffled deck. */
  private hands: Card[][] = [];
  private handIndex = -1;
  private currentCards: Card[] = [];
  /** Cached solver verdict for the current hand. NEVER sent to clients. */
  private currentSolve: SolveResult | null = null;

  table: TableCard[] = [];
  activePlayerId: string | null = null;
  private answerSteps: CombineStep[] = [];

  private timer: ActiveTimer | null = null;
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private phaseBeforePause: Phase | null = null;
  /**
   * The attempt that was in progress when the room paused. Someone else
   * dropping must not cancel a buzz, so it is restored on resume.
   */
  private pausedAnswer: { playerId: string; steps: CombineStep[] } | null = null;
  /**
   * Hand clock left when the last buzz froze it. A failed buzz resumes from
   * here rather than restarting the full clock, so a big table cannot stretch
   * one hand out by failing in turn.
   */
  private handIdleRemainingMs = HAND_IDLE_TIMEOUT_MS;

  lastResult: HandResultView | null = null;
  matchResult: MatchResultView | null = null;
  /** Matches won, kept across every match played in this room. */
  private seriesWins: Record<ScoreKey, number> = emptyScores();
  private matchesPlayed = 0;
  isTiebreak = false;
  lastActivity = Date.now();
  closed = false;

  constructor(
    code: string,
    host: { id: string; name: string; socketId: string },
    mode: GameMode,
    rules: RuleSet,
    private readonly events: RoomEvents,
    /** Non-null makes this a rated 1v1: fixed rules, one match, Elo at stake. */
    readonly rated: RatedKind | null = null,
  ) {
    this.code = code;
    this.hostId = host.id;
    this.mode = mode;
    this.rules = cleanRules(rules);
    this.players.push({
      id: host.id,
      name: host.name,
      socketId: host.socketId,
      connected: true,
      team: 'A',
      lockedOut: false,
    });
    this.seatTokens.set(host.id, newSeatToken());
  }

  // ---------------------------------------------------------------- seats

  hasSeat(playerId: string): boolean {
    return this.players.some((p) => p.id === playerId);
  }

  /** The reconnect secret for a seat, handed only to that seat's owner. */
  reconnectTokenFor(playerId: string): string | null {
    return this.seatTokens.get(playerId) ?? null;
  }

  /** True when `token` is this seat's reconnect secret. */
  checkReconnectToken(playerId: string, token: unknown): boolean {
    const expected = this.seatTokens.get(playerId);
    return typeof token === 'string' && expected !== undefined && sameSecret(token, expected);
  }

  /**
   * A rated match is over once its result is in. Its seats stay put so both
   * players can read the result screen, but nobody in it counts as busy.
   */
  get finished(): boolean {
    return this.rated !== null && this.phase === 'match-result';
  }

  /**
   * Put a seat back under a (new) socket. The caller has already checked the
   * seat credentials. If another socket still holds the seat, it loses it and
   * its id is returned so the caller can tell it and detach it: the newest
   * connection of the seat's owner wins (a refresh or a second tab must not
   * be locked out of its own seat while the old socket times out).
   */
  reconnect(playerId: string, socketId: string): SeatResult {
    this.touch();
    const existing = this.players.find((p) => p.id === playerId);
    const token = this.seatTokens.get(playerId);
    if (!existing || !token) return fail('not-in-room');
    const replacedSocketId =
      existing.socketId !== null && existing.socketId !== socketId ? existing.socketId : null;
    existing.socketId = socketId;
    existing.connected = true;
    const pending = this.disconnectTimers.get(existing.id);
    if (pending) {
      clearTimeout(pending);
      this.disconnectTimers.delete(existing.id);
    }
    this.resumeIfEveryoneBack();
    this.change();
    return { ok: true, reconnectToken: token, replacedSocketId };
  }

  // ---------------------------------------------------------------- lobby

  /** Why a new player with this name could not sit down now, or null if they can. */
  canJoin(name: string): ActionRejection | null {
    if (this.closed || this.phase !== 'lobby') return 'wrong-phase';
    if (this.players.length >= MODE_SEATS[this.mode].max) return 'room-full';
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return 'name-taken';
    return null;
  }

  /** Take a new seat. Seat ids are chosen by the server, never the client. */
  join(player: { id: string; name: string; socketId: string }): SeatResult {
    this.touch();
    if (this.hasSeat(player.id)) return fail('not-in-room');
    const blocked = this.canJoin(player.name);
    if (blocked) return fail(blocked);

    this.players.push({
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      connected: true,
      team: this.players.length % 2 === 0 ? 'A' : 'B',
      lockedOut: false,
    });
    const reconnectToken = newSeatToken();
    this.seatTokens.set(player.id, reconnectToken);
    this.change();
    return { ok: true, reconnectToken, replacedSocketId: null };
  }

  configure(playerId: string, mode?: GameMode, rules?: RuleSet): ActionResult {
    this.touch();
    if (playerId !== this.hostId) return fail('not-host');
    if (this.phase !== 'lobby') return fail('wrong-phase');
    if (mode) {
      if (this.players.length > MODE_SEATS[mode].max) return fail('room-full');
      this.mode = mode;
    }
    if (rules) this.rules = cleanRules(rules);
    this.change();
    return OK;
  }

  setTeam(actorId: string, playerId: string, team: TeamId): ActionResult {
    this.touch();
    if (this.phase !== 'lobby') return fail('wrong-phase');
    // The host may seat anyone; a player may seat themselves.
    if (actorId !== this.hostId && actorId !== playerId) return fail('not-host');
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return fail('not-in-room');
    player.team = team;
    this.change();
    return OK;
  }

  start(playerId: string): ActionResult {
    this.touch();
    if (playerId !== this.hostId) return fail('not-host');
    if (this.phase !== 'lobby') return fail('wrong-phase');
    const seats = MODE_SEATS[this.mode];
    if (this.players.length < seats.min || this.players.length > seats.max) {
      return fail('wrong-player-count');
    }
    if (this.mode === 'p4team') {
      const a = this.players.filter((p) => p.team === 'A').length;
      const b = this.players.filter((p) => p.team === 'B').length;
      if (a !== 2 || b !== 2) return fail('teams-unbalanced');
    }

    // First match in this room: the series tally starts here and then
    // survives every later match.
    this.seriesWins = emptyScores();
    this.matchesPlayed = 0;
    for (const key of this.scoreKeys()) this.seriesWins[key] = 0;
    this.beginMatch();
    return OK;
  }

  /** Host starts another match in the same room. Series wins carry over. */
  playAgain(playerId: string): ActionResult {
    this.touch();
    if (playerId !== this.hostId) return fail('not-host');
    if (this.phase !== 'match-result') return fail('wrong-phase');
    // A rated room is one match. Another rated game means requeuing or a
    // fresh challenge, so both players consent to putting their rating up.
    if (this.rated) return fail('wrong-phase');
    // Starting a match with an absent seat would deal hands nobody can answer.
    if (!this.players.every((p) => p.connected)) return fail('player-offline');
    if (this.players.length < MODE_SEATS[this.mode].min) return fail('wrong-player-count');
    this.beginMatch();
    return OK;
  }

  private beginMatch(): void {
    this.scores = emptyScores();
    for (const key of this.scoreKeys()) this.scores[key] = 0;
    this.hands = dealMatch();
    this.handIndex = -1;
    this.isTiebreak = false;
    this.matchResult = null;
    this.lastResult = null;
    this.dealNextHand();
  }

  // ------------------------------------------------------------- gameplay

  private dealNextHand(): void {
    this.handIndex += 1;
    const hand = this.isTiebreak
      ? shuffle(buildDeck()).slice(0, CARDS_PER_HAND)
      : this.hands[this.handIndex];
    if (!hand) {
      this.finishMatch();
      return;
    }

    this.currentCards = hand;
    this.currentSolve = solveCards(hand, this.rules);
    this.table = tableFromCards(hand);
    this.answerSteps = [];
    this.activePlayerId = null;
    this.lastResult = null;
    for (const p of this.players) p.lockedOut = false;
    this.handIdleRemainingMs = HAND_IDLE_TIMEOUT_MS;

    this.phase = 'open';
    this.startTimer('hand-idle', HAND_IDLE_TIMEOUT_MS, () => {
      this.endHand(resolveIdleTimeout());
    });
    this.change();
  }

  buzz(playerId: string): ActionResult {
    this.touch();
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return fail('not-in-room');
    // Buzz arbitration: the first request to reach this line wins, because
    // the phase flips to 'answering' synchronously before any await.
    if (this.phase !== 'open') return fail('too-late');
    if (player.lockedOut) return fail('locked-out');

    if (this.timer?.kind === 'hand-idle') {
      this.handIdleRemainingMs = Math.max(this.timer.endsAt - Date.now(), 0);
    }
    this.phase = 'answering';
    this.activePlayerId = playerId;
    this.table = tableFromCards(this.currentCards);
    this.answerSteps = [];

    this.startTimer('buzz-start', BUZZ_START_TIMEOUT_MS, () => {
      // Never touched a card in time — a failed attempt.
      this.finishAttempt(false);
    });
    this.change();
    return OK;
  }

  callNoSolution(playerId: string): ActionResult {
    this.touch();
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return fail('not-in-room');
    if (this.phase !== 'open') return fail('too-late');
    if (player.lockedOut) return fail('locked-out');

    this.clearTimer();
    this.endHand(resolveNoSolutionCall(this.scoringContext(), playerId));
    return OK;
  }

  combine(playerId: string, step: CombineStep): ActionResult {
    this.touch();
    if (this.phase !== 'answering') return fail('wrong-phase');
    if (playerId !== this.activePlayerId) return fail('not-your-turn');

    const isFirstInput = this.answerSteps.length === 0;
    const result = applyCombine(this.table, step, this.rules, this.answerSteps.length);
    if (!result.ok) {
      // Illegal combines do not stop the clock — the player just loses time.
      this.events.onCombineRejected(this, playerId, result.error);
      return fail('invalid-combine');
    }

    if (isFirstInput) {
      // The first card click is what converts the start timer into the
      // answer timer.
      this.startTimer('answer', ANSWER_TIMEOUT_MS, () => this.finishAttempt(false));
    }

    this.table = result.table;
    this.answerSteps.push(step);

    if (this.table.length === 1) {
      // Re-validate the whole sequence from the dealt cards. Incremental
      // application should already agree, but the full replay is the
      // authoritative check.
      const check = validateSteps(
        tableFromCards(this.currentCards),
        this.answerSteps,
        this.rules,
      );
      this.finishAttempt(check.valid);
      return OK;
    }

    this.change();
    return OK;
  }

  private finishAttempt(correct: boolean): void {
    this.clearTimer();
    const buzzerId = this.activePlayerId;
    if (!buzzerId) return;

    const resolution = resolveBuzz(this.scoringContext(), buzzerId, correct);
    if (resolution.lockOut) {
      const p = this.players.find((x) => x.id === resolution.lockOut);
      if (p) p.lockedOut = true;
    }

    if (resolution.handEnds) {
      // Show the buzzer's own route to 24, not whatever the solver found.
      const text = correct ? expressionForSteps(this.currentCards, this.answerSteps) : null;
      this.endHand(resolution, text ? { by: buzzerId, text } : null);
      return;
    }

    // Free-for-all: the hand stays live for whoever is left, on whatever was
    // left of the hand clock (with a short floor so the others get a real go).
    this.activePlayerId = null;
    this.answerSteps = [];
    this.table = tableFromCards(this.currentCards);
    this.phase = 'open';
    this.startTimer('hand-idle', Math.max(this.handIdleRemainingMs, HAND_RESUME_FLOOR_MS), () => {
      this.endHand(resolveIdleTimeout());
    });
    this.change();
  }

  private endHand(
    resolution: {
      points: Readonly<Record<ScoreKey, number>>;
      note: string;
    },
    playerSolution: { by: string; text: string } | null = null,
  ): void {
    this.clearTimer();
    this.scores = applyPoints(this.scores, resolution.points);
    this.activePlayerId = null;
    this.answerSteps = [];

    this.lastResult = {
      // Sudden-death hands carry on from 13: 14, 15, ... (same as state.handNumber).
      handNumber: this.handIndex + 1,
      cards: this.currentCards,
      solvable: this.currentSolve?.solvable ?? false,
      solution: playerSolution?.text ?? this.currentSolve?.expression ?? null,
      solvedBy: playerSolution?.by ?? null,
      pointsAwarded: resolution.points,
      note: resolution.note,
    };
    this.phase = 'hand-result';
    this.startTimer('result', HAND_RESULT_DISPLAY_MS, () => this.advanceAfterResult());
    this.change();
  }

  private advanceAfterResult(): void {
    const playedAllHands = this.handIndex + 1 >= HANDS_PER_MATCH;
    if (this.isTiebreak) {
      // Sudden death: keep dealing until the tie at the top breaks.
      if (needsTiebreak(this.scores)) this.dealNextHand();
      else this.finishMatch();
      return;
    }
    if (playedAllHands) {
      if (needsTiebreak(this.scores)) {
        this.isTiebreak = true;
        this.dealNextHand();
      } else {
        this.finishMatch();
      }
      return;
    }
    this.dealNextHand();
  }

  private finishMatch(): void {
    this.clearTimer();
    this.phase = 'match-result';
    const winners = leaders(this.scores);
    // Sudden death only ends once the tie at the top breaks, so there is
    // normally exactly one winner. Awarding every leader keeps the tally
    // honest if a match ever ends tied for another reason.
    for (const key of winners) {
      this.seriesWins[key] = (this.seriesWins[key] ?? 0) + 1;
    }
    this.matchesPlayed += 1;
    this.matchResult = {
      scores: this.scores,
      winners,
      wentToTiebreak: this.isTiebreak,
    };

    if (this.rated) {
      // Rated rooms are always exactly two players, seated in join order.
      const [a, b] = this.players;
      if (a && b) {
        this.events.onRatedMatchComplete?.(this, {
          kind: this.rated,
          playerAId: a.id,
          playerBId: b.id,
          scoreA: this.scores[a.id] ?? 0,
          scoreB: this.scores[b.id] ?? 0,
          wentToTiebreak: this.isTiebreak,
        });
      }
    }

    this.change();
  }

  // --------------------------------------------------------- connectivity

  /**
   * A socket left: either it disconnected, or (`leaving`) the player chose to
   * leave. Mid-match both hold the seat for the reconnect grace period; in a
   * finished guest match an explicit leave frees the seat at once.
   */
  disconnect(socketId: string, opts: { leaving?: boolean } = {}): void {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;

    if (this.phase === 'lobby') {
      this.removeSeat(player.id);
      if (this.players.length === 0) {
        this.close('everyone left the lobby');
        return;
      }
      this.ensureConnectedHost();
      this.change();
      return;
    }

    if (this.phase === 'match-result') {
      if (!this.players.some((p) => p.connected)) {
        this.close('everyone left');
        return;
      }
      this.ensureConnectedHost();
      // A finished rated room is only a result screen; nobody plays on in it.
      if (!this.rated) {
        if (opts.leaving) {
          this.vacateAfterMatch(player.id);
          return;
        }
        // A dropped connection gets the usual grace to come back; after
        // that the seat is freed so the others can play on without them.
        this.setDisconnectTimer(player.id, () => this.vacateAfterMatch(player.id));
      }
      this.change();
      return;
    }

    // Mid-match. The host keeps the seat (and the role) while paused: the
    // room cannot resume or reach a host-only phase until every seat is back,
    // and it closes if this one never returns.

    if (this.phase === 'answering' && this.activePlayerId === player.id) {
      // Dropping mid-answer counts as a failed attempt, so disconnecting is
      // never a way to escape a buzz that is going badly.
      this.finishAttempt(false);
    } else if (this.phase === 'paused' && this.pausedAnswer?.playerId === player.id) {
      // The room was already paused (someone else dropped) with this player
      // mid-answer. Their drop still forfeits the attempt.
      const { steps } = this.pausedAnswer;
      this.pausedAnswer = null;
      this.phase = this.phaseBeforePause ?? 'answering';
      this.phaseBeforePause = null;
      this.activePlayerId = player.id;
      this.answerSteps = steps;
      this.finishAttempt(false);
    }

    if (this.phase !== 'paused') this.pause();

    this.setDisconnectTimer(player.id, () => this.close(`${player.name} did not reconnect`));
    this.change();
  }

  /** Freeze the hand, remembering what is needed to pick it up again. */
  private pause(): void {
    if (this.phase === 'open' && this.timer?.kind === 'hand-idle') {
      this.handIdleRemainingMs = Math.max(this.timer.endsAt - Date.now(), 0);
    }
    if (this.phase === 'answering' && this.activePlayerId) {
      this.pausedAnswer = { playerId: this.activePlayerId, steps: [...this.answerSteps] };
    }
    this.phaseBeforePause = this.phase;
    this.clearTimer();
    this.phase = 'paused';
  }

  private setDisconnectTimer(playerId: string, onExpire: () => void): void {
    const previous = this.disconnectTimers.get(playerId);
    if (previous) clearTimeout(previous);
    const handle = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      onExpire();
    }, RECONNECT_GRACE_MS);
    this.disconnectTimers.set(playerId, handle);
  }

  private removeSeat(playerId: string): void {
    this.players = this.players.filter((p) => p.id !== playerId);
    this.seatTokens.delete(playerId);
    const pending = this.disconnectTimers.get(playerId);
    if (pending) clearTimeout(pending);
    this.disconnectTimers.delete(playerId);
  }

  /** The host role always sits with someone connected, when anyone is. */
  private ensureConnectedHost(): void {
    const host = this.players.find((p) => p.id === this.hostId);
    if (host?.connected) return;
    const next = this.players.find((p) => p.connected) ?? this.players[0];
    if (next) this.hostId = next.id;
  }

  /**
   * Free a seat in a finished guest match. If too few players remain for
   * another match in this mode, the room goes back to the lobby so new
   * players can join with the same code.
   */
  private vacateAfterMatch(playerId: string): void {
    if (this.closed || this.phase !== 'match-result') return;
    this.removeSeat(playerId);
    if (!this.players.some((p) => p.connected)) {
      this.close('everyone left');
      return;
    }
    if (this.players.length < MODE_SEATS[this.mode].min) {
      for (const p of this.players.filter((x) => !x.connected)) this.removeSeat(p.id);
      this.phase = 'lobby';
      this.scores = emptyScores();
      this.hands = [];
      this.handIndex = -1;
      this.currentCards = [];
      this.currentSolve = null;
      this.table = [];
      this.lastResult = null;
      this.matchResult = null;
      this.isTiebreak = false;
      for (const p of this.players) p.lockedOut = false;
    }
    this.ensureConnectedHost();
    this.change();
  }

  private resumeIfEveryoneBack(): void {
    if (this.phase !== 'paused') return;
    if (!this.players.every((p) => p.connected)) return;

    const resumeTo = this.phaseBeforePause ?? 'open';
    this.phaseBeforePause = null;
    const answer = this.pausedAnswer;
    this.pausedAnswer = null;

    if (resumeTo === 'hand-result') {
      this.phase = 'hand-result';
      this.startTimer('result', HAND_RESULT_DISPLAY_MS, () => this.advanceAfterResult());
      return;
    }

    if (resumeTo === 'answering' && answer) {
      // The interrupted attempt carries on where it was, with a fresh window
      // for whichever step it had reached.
      this.phase = 'answering';
      this.activePlayerId = answer.playerId;
      this.answerSteps = answer.steps;
      if (answer.steps.length === 0) {
        this.startTimer('buzz-start', BUZZ_START_TIMEOUT_MS, () => this.finishAttempt(false));
      } else {
        this.startTimer('answer', ANSWER_TIMEOUT_MS, () => this.finishAttempt(false));
      }
      return;
    }

    // Open play resumes on the hand clock that was left when it paused, with
    // the same floor a failed buzz gets.
    this.activePlayerId = null;
    this.answerSteps = [];
    this.table = tableFromCards(this.currentCards);
    this.phase = 'open';
    this.startTimer('hand-idle', Math.max(this.handIdleRemainingMs, HAND_RESUME_FLOOR_MS), () => {
      this.endHand(resolveIdleTimeout());
    });
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    for (const handle of this.disconnectTimers.values()) clearTimeout(handle);
    this.disconnectTimers.clear();
    this.events.onClosed(this, reason);
  }

  // -------------------------------------------------------------- helpers

  private scoringContext(): HandScoringContext {
    const teamOf = Object.create(null) as Record<string, TeamId>;
    for (const p of this.players) if (p.team) teamOf[p.id] = p.team;
    return {
      mode: this.mode,
      playerIds: this.players.map((p) => p.id),
      teamOf,
      solvable: this.currentSolve?.solvable ?? false,
      lockedOut: this.players.filter((p) => p.lockedOut).map((p) => p.id),
    };
  }

  private scoreKeys(): ScoreKey[] {
    return this.mode === 'p4team' ? ['A', 'B'] : this.players.map((p) => p.id);
  }

  private startTimer(kind: TimerKind, durationMs: number, onExpire: () => void): void {
    this.clearTimer();
    const handle = setTimeout(() => {
      this.timer = null;
      onExpire();
    }, durationMs);
    this.timer = { kind, endsAt: Date.now() + durationMs, durationMs, handle };
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  /**
   * Broadcast a state change. This deliberately does NOT count as activity:
   * timers change state on their own, and if they kept the room "active" a
   * room nobody is playing in (all seats gone, sudden death dealing itself
   * hand after hand) would never be swept. Player actions call touch().
   */
  private change(): void {
    this.events.onChange(this);
  }

  /**
   * Seats that still look connected but whose socket the server no longer
   * has are treated as disconnected (pause, grace, close as usual).
   */
  dropDeadSockets(isAlive: (socketId: string) => boolean): void {
    for (const p of [...this.players]) {
      if (this.closed) return;
      if (p.connected && p.socketId && !isAlive(p.socketId)) this.disconnect(p.socketId);
    }
  }

  isIdle(now: number, maxIdleMs: number): boolean {
    return now - this.lastActivity > maxIdleMs;
  }

  /** The view sent to clients. Excludes the solver verdict for the live hand. */
  publicState(): PublicGameState {
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === this.hostId,
      team: this.mode === 'p4team' ? p.team : null,
      lockedOut: p.lockedOut,
    }));

    const dealt = this.handIndex + 1;
    return {
      roomCode: this.code,
      mode: this.mode,
      rules: this.rules,
      phase: this.phase,
      hostId: this.hostId,
      players,
      scores: this.scores,
      handNumber: Math.max(dealt, 0),
      totalHands: HANDS_PER_MATCH,
      cardsRemaining: Math.max((HANDS_PER_MATCH - dealt) * CARDS_PER_HAND, 0),
      cards: this.currentCards,
      table: this.table,
      activePlayerId: this.activePlayerId,
      timer: this.timer
        ? {
            kind: this.timer.kind,
            endsAt: this.timer.endsAt,
            durationMs: this.timer.durationMs,
            remainingMs: Math.max(this.timer.endsAt - Date.now(), 0),
          }
        : null,
      lastResult: this.lastResult,
      matchResult: this.matchResult,
      series: { wins: this.seriesWins, matchesPlayed: this.matchesPlayed },
      rated: this.rated,
      isTiebreak: this.isTiebreak,
    };
  }
}
