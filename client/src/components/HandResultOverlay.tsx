import type { HandResultView, PublicGameState } from '@24game/shared';

function pointsLine(result: HandResultView, state: PublicGameState): string {
  const entries = Object.entries(result.pointsAwarded);
  if (entries.length === 0) return 'No points awarded';
  return entries
    .map(([key, value]) => {
      const name =
        state.mode === 'p4team'
          ? `Team ${key}`
          : (state.players.find((p) => p.id === key)?.name ?? key);
      const amount = Number.isInteger(value) ? value : value.toFixed(1);
      return `${name} +${amount}`;
    })
    .join(' · ');
}

export function HandResultOverlay({
  result,
  state,
}: {
  result: HandResultView;
  state: PublicGameState;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/85 p-5 backdrop-blur-sm">
      <div className="panel w-full max-w-sm space-y-3 text-center">
        <p className="text-xs uppercase tracking-widest text-slate-400">
          Hand {result.handNumber}
          {state.isTiebreak && ' · sudden death'}
        </p>
        <p className="text-xl font-bold">{result.note}</p>
        <p className="text-sm text-emerald-400">{pointsLine(result, state)}</p>

        <div className="rounded-xl bg-slate-950/60 p-3">
          {result.solvable ? (
            <>
              <p className="text-xs uppercase tracking-wide text-slate-500">One solution</p>
              <p className="mt-1 break-words font-mono text-lg text-slate-100">
                {result.solution} = 24
              </p>
            </>
          ) : (
            <p className="font-semibold text-amber-400">This hand had no solution.</p>
          )}
        </div>

        <p className="text-xs text-slate-500">Next hand shortly…</p>
      </div>
    </div>
  );
}
