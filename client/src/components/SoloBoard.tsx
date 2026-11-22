import type { ReactNode } from 'react';
import { CombineBoard } from './CombineBoard.js';
import { CountdownBar } from './Countdown.js';
import type { TrainingGame, TrainingState } from '../training.js';
import { TurnUpright } from './TurnUpright.js';

/**
 * The solo play surface shared by practice and the daily: clock, cards,
 * buzz / no-solution, and the per-hand result card. Callers supply the header
 * and anything that sits above the clock.
 */
export function SoloBoard({
  game,
  state,
  header,
  above,
}: {
  game: TrainingGame;
  state: TrainingState;
  header: ReactNode;
  above?: ReactNode;
}) {
  const isAnswering = state.phase === 'answering';
  const canAct = state.phase === 'open';
  const result = state.lastResult;

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-5 pb-6 pt-3">
      <TurnUpright />
      {header}
      {above}

      <div className="h-9">
        <CountdownBar timer={state.timer} />
      </div>

      <div className="flex flex-1 flex-col justify-center gap-4">
        <p className="text-center font-display text-2xl font-semibold" aria-live="polite">
          {isAnswering ? 'Your turn. Make 24.' : 'Make 24.'}
        </p>
        <CombineBoard
          dealt={state.cards}
          table={state.table}
          interactive={isAnswering}
          onCombine={(step) => game.combine(step)}
          errorNonce={state.combineError?.nonce ?? 0}
          errorMessage={state.combineError?.message ?? null}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          className="btn-primary col-span-2 h-16 text-xl font-bold"
          disabled={!canAct}
          onClick={() => game.buzz()}
        >
          Buzz in
        </button>
        <button
          type="button"
          className="btn-secondary h-16 px-2 text-sm"
          disabled={!canAct}
          onClick={() => game.callNoSolution()}
        >
          No solution
        </button>
      </div>

      {state.phase === 'result' && result && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-paper/95 p-5">
          <div className="panel w-full max-w-sm space-y-3 text-center">
            <p
              className={`font-display text-3xl font-extrabold ${
                result.correct ? 'text-good' : 'text-bad'
              }`}
            >
              {result.correct ? 'Correct' : 'Missed'}
            </p>
            <p className="text-sm text-ink">{result.note}</p>
            <div className="rounded-md bg-paper p-3">
              {result.solvable ? (
                <>
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {result.ownSolution ? 'Your solution' : 'One solution'}
                  </p>
                  <p className="mt-1 break-words font-mono text-lg">{result.solution} = 24</p>
                </>
              ) : (
                <p className="font-semibold text-ink">This hand had no solution.</p>
              )}
            </div>
            <button type="button" className="btn-secondary w-full" onClick={() => game.next()}>
              {state.handNumber >= state.totalHands ? 'See results' : 'Next hand'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
