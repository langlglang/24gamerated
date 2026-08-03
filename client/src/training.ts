import { useEffect, useRef, useState } from 'react';
import {
  ANSWER_TIMEOUT_MS,
  BUZZ_START_TIMEOUT_MS,
  HANDS_PER_MATCH,
  HAND_IDLE_TIMEOUT_MS,
  HAND_RESULT_DISPLAY_MS,
  applyCombine,
  dealMatch,
  solveCards,
  tableFromCards,
  validateSteps,
  type Card,
  type CombineStep,
  type RuleSet,
  type TableCard,
  type TimerKind,
  type TimerView,
  type ValidationError,
} from '@24game/shared';
import { describeValidationError } from '@24game/shared';

export type TrainingPhase = 'open' | 'answering' | 'result' | 'done';

export interface TrainingStats {
  handsPlayed: number;
  buzzes: number;
  solved: number;
  /** Total ms from first card click to the final combine, over solved hands. */
  solveTimeMs: number;
  noSolutionCalls: number;
  noSolutionCorrect: number;
}

export interface TrainingResult {
  handNumber: number;
  solvable: boolean;
  solution: string | null;
  note: string;
  correct: boolean;
}

export interface TrainingState {
  phase: TrainingPhase;
  handNumber: number;
  totalHands: number;
  cards: readonly Card[];
  table: readonly TableCard[];
  timer: TimerView | null;
  lastResult: TrainingResult | null;
  stats: TrainingStats;
  combineError: { message: string; nonce: number } | null;
}

/**
 * The solo arena runs the exact same deck, solver, validator, and timer
 * durations as a room — just locally, with no server and no room code. All the
 * rule logic comes from @24game/shared, so training and multiplayer can never
 * disagree about what counts as a legal move.
 */
export class TrainingGame {
  private hands: Card[][] = [];
  private handIndex = -1;
  private cards: Card[] = [];
  private solve = { solvable: false, expression: null as string | null };
  private table: TableCard[] = [];
  private steps: CombineStep[] = [];
  private phase: TrainingPhase = 'open';
  private timer: { kind: TimerKind; endsAt: number; durationMs: number } | null = null;
  private handle: ReturnType<typeof setTimeout> | null = null;
  private answerStartedAt = 0;
  private errorNonce = 0;
  private combineError: { message: string; nonce: number } | null = null;
  private lastResult: TrainingResult | null = null;

  stats: TrainingStats = {
    handsPlayed: 0,
    buzzes: 0,
    solved: 0,
    solveTimeMs: 0,
    noSolutionCalls: 0,
    noSolutionCorrect: 0,
  };

  private listeners = new Set<() => void>();

  constructor(private rules: RuleSet) {
    this.hands = dealMatch();
    this.dealNext();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private setTimer(kind: TimerKind, durationMs: number, onExpire: () => void): void {
    this.clearTimer();
    this.timer = { kind, endsAt: Date.now() + durationMs, durationMs };
    this.handle = setTimeout(() => {
      this.timer = null;
      onExpire();
    }, durationMs);
  }

  private clearTimer(): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
    this.timer = null;
  }

  private dealNext(): void {
    this.handIndex += 1;
    const hand = this.hands[this.handIndex];
    if (!hand) {
      this.clearTimer();
      this.phase = 'done';
      this.emit();
      return;
    }
    this.cards = hand;
    const solved = solveCards(hand, this.rules);
    this.solve = { solvable: solved.solvable, expression: solved.expression };
    this.table = tableFromCards(hand);
    this.steps = [];
    this.combineError = null;
    this.lastResult = null;
    this.phase = 'open';
    this.setTimer('hand-idle', HAND_IDLE_TIMEOUT_MS, () =>
      this.endHand({ note: 'Time up — no attempt', correct: false }),
    );
    this.emit();
  }

  buzz(): void {
    if (this.phase !== 'open') return;
    this.phase = 'answering';
    this.table = tableFromCards(this.cards);
    this.steps = [];
    this.stats.buzzes += 1;
    this.setTimer('buzz-start', BUZZ_START_TIMEOUT_MS, () =>
      this.endHand({ note: 'Too slow to start', correct: false }),
    );
    this.emit();
  }

  callNoSolution(): void {
    if (this.phase !== 'open') return;
    this.stats.noSolutionCalls += 1;
    const correct = !this.solve.solvable;
    if (correct) this.stats.noSolutionCorrect += 1;
    this.endHand({
      note: correct ? 'Correct — no solution exists' : 'Wrong — this hand was solvable',
      correct,
    });
  }

  combine(step: CombineStep): void {
    if (this.phase !== 'answering') return;
    const first = this.steps.length === 0;
    const result = applyCombine(this.table, step, this.rules, this.steps.length);
    if (!result.ok) {
      this.flagError(result.error);
      return;
    }
    if (first) {
      this.answerStartedAt = Date.now();
      this.setTimer('answer', ANSWER_TIMEOUT_MS, () =>
        this.endHand({ note: 'Ran out of time', correct: false }),
      );
    }
    this.table = result.table;
    this.steps.push(step);

    if (this.table.length === 1) {
      const check = validateSteps(tableFromCards(this.cards), this.steps, this.rules);
      const elapsed = Date.now() - this.answerStartedAt;
      if (check.valid) {
        this.stats.solved += 1;
        this.stats.solveTimeMs += elapsed;
        this.endHand({ note: `Solved in ${(elapsed / 1000).toFixed(1)}s`, correct: true });
      } else {
        this.endHand({ note: 'That is not 24', correct: false });
      }
      return;
    }
    this.emit();
  }

  private flagError(error: ValidationError): void {
    this.errorNonce += 1;
    this.combineError = { message: describeValidationError(error), nonce: this.errorNonce };
    this.emit();
  }

  private endHand(outcome: { note: string; correct: boolean }): void {
    this.clearTimer();
    this.stats.handsPlayed += 1;
    this.phase = 'result';
    this.lastResult = {
      handNumber: this.handIndex + 1,
      solvable: this.solve.solvable,
      solution: this.solve.expression,
      note: outcome.note,
      correct: outcome.correct,
    };
    this.setTimer('result', HAND_RESULT_DISPLAY_MS, () => this.dealNext());
    this.emit();
  }

  /** Skip the result countdown. */
  next(): void {
    if (this.phase !== 'result') return;
    this.dealNext();
  }

  restart(): void {
    this.clearTimer();
    this.hands = dealMatch();
    this.handIndex = -1;
    this.stats = {
      handsPlayed: 0,
      buzzes: 0,
      solved: 0,
      solveTimeMs: 0,
      noSolutionCalls: 0,
      noSolutionCorrect: 0,
    };
    this.dealNext();
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  snapshot(): TrainingState {
    return {
      phase: this.phase,
      handNumber: this.handIndex + 1,
      totalHands: HANDS_PER_MATCH,
      cards: this.cards,
      table: this.table,
      timer: this.timer
        ? {
            ...this.timer,
            remainingMs: Math.max(this.timer.endsAt - Date.now(), 0),
          }
        : null,
      lastResult: this.lastResult,
      stats: this.stats,
      combineError: this.combineError,
    };
  }
}

export function useTraining(rules: RuleSet): { game: TrainingGame; state: TrainingState } {
  const gameRef = useRef<TrainingGame | null>(null);
  if (!gameRef.current) gameRef.current = new TrainingGame(rules);
  const game = gameRef.current;

  const [state, setState] = useState<TrainingState>(() => game.snapshot());

  useEffect(() => {
    const unsubscribe = game.subscribe(() => setState(game.snapshot()));
    setState(game.snapshot());
    return () => {
      unsubscribe();
    };
  }, [game]);

  useEffect(() => () => game.dispose(), [game]);

  return { game, state };
}
