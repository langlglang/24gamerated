import { useState } from 'react';
import { describeRules, type RuleSet } from '@24game/shared';
import { CombineBoard } from '../components/CombineBoard.js';
import { CountdownBar } from '../components/Countdown.js';
import { RuleToggles } from '../components/RuleToggles.js';
import { useTraining } from '../training.js';

function StatsPanel({
  stats,
}: {
  stats: ReturnType<typeof useTraining>['state']['stats'];
}) {
  const solveRate = stats.buzzes === 0 ? null : (stats.solved / stats.buzzes) * 100;
  const avgSolve = stats.solved === 0 ? null : stats.solveTimeMs / stats.solved / 1000;
  const callRate =
    stats.noSolutionCalls === 0 ? null : (stats.noSolutionCorrect / stats.noSolutionCalls) * 100;

  const rows: [string, string][] = [
    ['Hands played', String(stats.handsPlayed)],
    ['Buzzes', String(stats.buzzes)],
    ['Solved', String(stats.solved)],
    ['Solve rate', solveRate === null ? '—' : `${solveRate.toFixed(0)}%`],
    ['Avg solve time', avgSolve === null ? '—' : `${avgSolve.toFixed(1)}s`],
    [
      'No-solution calls',
      stats.noSolutionCalls === 0
        ? '—'
        : `${stats.noSolutionCorrect}/${stats.noSolutionCalls}${
            callRate === null ? '' : ` (${callRate.toFixed(0)}%)`
          }`,
    ],
  ];

  return (
    <div className="panel grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-slate-400">{label}</span>
          <span className="font-semibold tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Arena({ rules, onExit }: { rules: RuleSet; onExit: () => void }) {
  const { game, state } = useTraining(rules);
  const isAnswering = state.phase === 'answering';
  const canAct = state.phase === 'open';
  const combinesMade = state.cards.length - state.table.length;

  if (state.phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 p-5">
        <h1 className="text-center text-3xl font-black text-emerald-400">Session complete</h1>
        <StatsPanel stats={state.stats} />
        <button type="button" className="btn-primary" onClick={() => game.restart()}>
          New deck
        </button>
        <button type="button" className="btn-secondary" onClick={onExit}>
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between text-xs text-slate-400">
        <button type="button" className="underline" onClick={onExit}>
          Exit
        </button>
        <span>
          Hand {state.handNumber} / {state.totalHands}
        </span>
        <span>{describeRules(rules)}</span>
      </header>

      <StatsPanel stats={state.stats} />

      <div className="h-8">
        <CountdownBar timer={state.timer} />
      </div>

      <div className="flex-1">
        <CombineBoard
          dealt={state.cards}
          table={state.table}
          interactive={isAnswering}
          onCombine={(step) => game.combine(step)}
          onUndo={() => game.undo()}
          canUndo={isAnswering && combinesMade > 0}
          errorNonce={state.combineError?.nonce ?? 0}
          errorMessage={state.combineError?.message ?? null}
        />
      </div>

      <div className="space-y-2 pb-2">
        <button
          type="button"
          className="btn-primary h-24 w-full text-3xl font-black"
          disabled={!canAct}
          onClick={() => game.buzz()}
        >
          BUZZ
        </button>
        <button
          type="button"
          className="btn-secondary w-full text-sm"
          disabled={!canAct}
          onClick={() => game.callNoSolution()}
        >
          No solution
        </button>
      </div>

      {state.phase === 'result' && state.lastResult && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/85 p-5 backdrop-blur-sm">
          <div className="panel w-full max-w-sm space-y-3 text-center">
            <p
              className={`text-2xl font-black ${
                state.lastResult.correct ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {state.lastResult.correct ? 'Correct' : 'Missed'}
            </p>
            <p className="text-sm text-slate-300">{state.lastResult.note}</p>
            <div className="rounded-xl bg-slate-950/60 p-3">
              {state.lastResult.solvable ? (
                <>
                  <p className="text-xs uppercase tracking-wide text-slate-500">One solution</p>
                  <p className="mt-1 break-words font-mono text-lg">
                    {state.lastResult.solution} = 24
                  </p>
                </>
              ) : (
                <p className="font-semibold text-amber-400">This hand had no solution.</p>
              )}
            </div>
            <button type="button" className="btn-secondary w-full" onClick={() => game.next()}>
              Next hand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Training({ onExit }: { onExit: () => void }) {
  const [rules, setRules] = useState<RuleSet>({ fractions: true, negatives: true });
  const [started, setStarted] = useState(false);

  if (started) {
    // Keying on the rules guarantees a clean game if they ever change.
    return (
      <Arena
        key={`${rules.fractions}-${rules.negatives}`}
        rules={rules}
        onExit={() => setStarted(false)}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
      <h1 className="text-center text-3xl font-black text-emerald-400">Training arena</h1>
      <p className="text-center text-sm text-slate-400">
        One full deck, 13 hands, the same 3-second start and 10-second answer clocks as a real
        match.
      </p>
      <div className="panel">
        <RuleToggles rules={rules} onChange={setRules} disabled={false} />
      </div>
      <button type="button" className="btn-primary text-lg" onClick={() => setStarted(true)}>
        Start training
      </button>
      <button type="button" className="btn-secondary" onClick={onExit}>
        Back to home
      </button>
    </div>
  );
}
