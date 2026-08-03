import type { PublicGameState } from '@24game/shared';

function formatScore(value: number): string {
  // Halves are real in 3-player mode, so 1.5 must not render as 2.
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function Scoreboard({
  state,
  selfId,
}: {
  state: PublicGameState;
  selfId: string | null;
}) {
  if (state.mode === 'p4team') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {(['A', 'B'] as const).map((team) => {
          const members = state.players.filter((p) => p.team === team);
          const mine = members.some((p) => p.id === selfId);
          return (
            <div
              key={team}
              className={`panel ${mine ? 'border-emerald-500/60' : ''}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-300">Team {team}</span>
                <span className="text-2xl font-bold tabular-nums">
                  {formatScore(state.scores[team] ?? 0)}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                {members.map((p) => (
                  <li key={p.id} className={p.lockedOut ? 'line-through opacity-50' : ''}>
                    {p.name}
                    {!p.connected && ' (offline)'}
                    {p.id === state.activePlayerId && ' — answering'}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {state.players.map((p) => {
        const isSelf = p.id === selfId;
        const answering = p.id === state.activePlayerId;
        return (
          <div
            key={p.id}
            className={[
              'panel flex-1 min-w-[8rem]',
              isSelf ? 'border-emerald-500/60' : '',
              p.lockedOut ? 'opacity-50' : '',
              answering ? 'ring-2 ring-amber-400' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-slate-300">
                {p.name}
                {isSelf && ' (you)'}
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {formatScore(state.scores[p.id] ?? 0)}
              </span>
            </div>
            <div className="mt-0.5 h-4 text-xs text-slate-400">
              {!p.connected && 'offline'}
              {p.connected && p.lockedOut && 'locked out'}
              {p.connected && !p.lockedOut && answering && 'answering…'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
