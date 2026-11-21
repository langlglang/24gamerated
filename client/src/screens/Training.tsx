import { useState } from 'react';
import { describeRules, type RuleSet } from '@24game/shared';
import { RuleToggles } from '../components/RuleToggles.js';
import { SoloBoard } from '../components/SoloBoard.js';
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
          <span className="text-muted">{label}</span>
          <span className="font-semibold tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Arena({ rules, onExit }: { rules: RuleSet; onExit: () => void }) {
  const { game, state } = useTraining(rules);

  if (state.phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 p-5">
        <h1 className="text-center font-display text-4xl font-extrabold">Session complete</h1>
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
    <SoloBoard
      game={game}
      state={state}
      header={
        <header className="flex h-11 items-center justify-between border-b border-ink text-sm">
          <button type="button" className="-ml-1 min-h-[44px] px-1 font-semibold underline" onClick={onExit}>
            Exit
          </button>
          <span className="font-display text-xl font-extrabold">Practice</span>
          <span className="font-semibold tabular-nums">
            {state.handNumber}/{state.totalHands}
          </span>
        </header>
      }
      above={
        <>
          <StatsPanel stats={state.stats} />
          <p className="-mt-2 text-center text-xs text-muted">{describeRules(rules)}</p>
        </>
      }
    />
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
      <h1 className="text-center font-display text-4xl font-extrabold">Training arena</h1>
      <p className="text-center text-sm text-muted">
        One full deck, 13 hands, the same 5-second start and 10-second answer clocks as a real
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
