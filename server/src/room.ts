import {
  ANSWER_TIMEOUT_MS,
  BUZZ_START_TIMEOUT_MS,
  CARDS_PER_HAND,
  HANDS_PER_MATCH,
  HAND_IDLE_TIMEOUT_MS,
  HAND_RESULT_DISPLAY_MS,
  MODE_PLAYER_COUNT,
  RECONNECT_GRACE_MS,
  applyPoints,
  buildDeck,
  dealMatch,
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
  type RuleSet,
  type ScoreKey,
  type SolveResult,
  type TableCard,
  type TeamId,
  type TimerKind,
  type ValidationError,
} from '@24game/shared';
import { applyCombine } from '@24game/shared';

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
};

export type ActionResult = { ok: true } | { ok: false; error: ActionRejection };

const OK: ActionResult = { ok: true };
const fail = (error: ActionRejection): ActionResult => ({ ok: false, error });

/**
 * One room's authoritative game state. Every rule that matters — the deck, the
 * solver verdict, buzz arbitration, timers, scoring — is decided here. Clients
 * only ever send intents.
 */
export class Room {
  readonly code: string;
  hostId: string;
  mode: GameMode = 'p2';
  rules: RuleSet = { fractions: true, negatives: true };
  players: Player[] = [];

  phase: Phase = 'lobby';
  scores: Record<ScoreKey, number> = {};

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

  lastResult: HandResultView | null = null;
  matchResult: MatchResultView | null = null;
  /** Matches won, kept across every match played in this room. */
  private seriesWins: Record<ScoreKey, number> = {};
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
  ) {
    this.code = code;
    this.hostId = host.id;
    this.mode = mode;
    this.rules = rules;
    this.players.push({
      id: host.id,
      name: host.name,
      socketId: host.socketId,
      connected: true,
      team: 'A',
      lockedOut: false,
    });
  }

  // ---------------------------------------------------------------- lobby

  join(player: { id: string; name: string; socketId: string }): ActionResult {
    this.touch();
    const existing = this.players.find((p) => p.id === player.id);
    if (existing) {
      // Reconnect into the same seat.
      existing.socketId = player.socketId;
      existing.connected = true;
      const pending = this.disconnectTimers.get(existing.id);
      if (pending) {
        clearTimeout(pending);
        this.disconnectTimers.delete(existing.id);
      }
      this.resumeIfEveryoneBack();
      this.change();
      return OK;
    }

    if (this.phase !== 'lobby') return fail('wrong-phase');
    if (this.players.length >= MODE_PLAYER_COUNT[this.mode]) return fail('room-full');
    if (this.players.some((p) => p.name.toLowerCase() === player.name.toLowerCase())) {
      return fail('name-taken');
    }

    this.players.push({
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      connected: true,
      team: this.players.length % 2 === 0 ? 'A' : 'B',
      lockedOut: false,
    });
    this.change();
    return OK;
  }

  configure(playerId: string, mode?: GameMode, rules?: RuleSet): ActionResult {
    this.touch();
    if (playerId !== this.hostId) return fail('not-host');
    if (this.phase !== 'lobby') return fail('wrong-phase');
    if (mode) {
      if (this.players.length > MODE_PLAYER_COUNT[mode]) return fail('room-full');
      this.mode = mode;
    }
    if (rules) this.rules = rules;
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
    if (this.players.length !== MODE_PLAYER_COUNT[this.mode]) return fail('wrong-player-count');
    if (this.mode === 'p4team') {
      const a = this.players.filter((p) => p.team === 'A').length;
      const b = this.players.filter((p) => p.team === 'B').length;
      if (a !== 2 || b !== 2) return fail('teams-unbalanced');
    }

    // First match in this room: the series tally starts here and then
    // survives every later match.
    this.seriesWins = {};
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
    // Starting a match with an absent seat would deal hands nobody can answer.
    if (!this.players.every((p) => p.connected)) return fail('player-offline');
    this.beginMatch();
    return OK;
  }

  private beginMatch(): void {
    this.scores = {};
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
      this.endHand(resolution);
      return;
    }

    // 3-player: the hand stays live for whoever is left.
    this.activePlayerId = null;
    this.answerSteps = [];
    this.table = tableFromCards(this.currentCards);
    this.phase = 'open';
    this.startTimer('hand-idle', HAND_IDLE_TIMEOUT_MS, () => {
      this.endHand(resolveIdleTimeout());
    });
    this.change();
  }

  private endHand(resolution: {
    points: Readonly<Record<ScoreKey, number>>;
    note: string;
  }): void {
    this.clearTimer();
    this.scores = applyPoints(this.scores, resolution.points);
    this.activePlayerId = null;
    this.answerSteps = [];

    this.lastResult = {
      handNumber: this.isTiebreak ? HANDS_PER_MATCH + 1 : this.handIndex + 1,
      cards: this.currentCards,
      solvable: this.currentSolve?.solvable ?? false,
      solution: this.currentSolve?.expression ?? null,
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
    this.change();
  }

  // --------------------------------------------------------- connectivity

  disconnect(socketId: string): void {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;

    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== player.id);
      if (this.players.length === 0) {
        this.close('everyone left the lobby');
        return;
      }
      if (this.hostId === player.id) this.hostId = this.players[0]!.id;
      this.change();
      return;
    }

    if (this.phase === 'match-result') {
      this.change();
      return;
    }

    // Dropping mid-answer counts as a failed attempt, so disconnecting is
    // never a way to escape a buzz that is going badly.
    if (this.phase === 'answering' && this.activePlayerId === player.id) {
      this.finishAttempt(false);
    }

    if (this.phase !== 'paused') {
      this.phaseBeforePause = this.phase;
      this.clearTimer();
      this.phase = 'paused';
    }

    const handle = setTimeout(() => {
      this.close(`${player.name} did not reconnect`);
    }, RECONNECT_GRACE_MS);
    this.disconnectTimers.set(player.id, handle);
    this.change();
  }

  private resumeIfEveryoneBack(): void {
    if (this.phase !== 'paused') return;
    if (!this.players.every((p) => p.connected)) return;

    const resumeTo = this.phaseBeforePause ?? 'open';
    this.phaseBeforePause = null;

    if (resumeTo === 'hand-result') {
      this.phase = 'hand-result';
      this.startTimer('result', HAND_RESULT_DISPLAY_MS, () => this.advanceAfterResult());
      return;
    }
    // Any interrupted answer was already resolved as a failure, so the hand
    // resumes open with a fresh idle clock.
    this.activePlayerId = null;
    this.answerSteps = [];
    this.table = tableFromCards(this.currentCards);
    this.phase = 'open';
    this.startTimer('hand-idle', HAND_IDLE_TIMEOUT_MS, () => {
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
    const teamOf: Record<string, TeamId> = {};
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

  private change(): void {
    this.touch();
    this.events.onChange(this);
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
      isTiebreak: this.isTiebreak,
    };
  }
}
