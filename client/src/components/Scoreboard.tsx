import type { PlayerView, PublicGameState } from '@24game/shared';

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statusOf(p: PlayerView, state: PublicGameState): string {
  if (!p.connected) return 'offline';
  if (p.lockedOut) return 'locked out';
  if (p.id === state.activePlayerId) return 'answering…';
  return '';
}

/**
 * Two players: a big head-to-head line, you on the left. Teams: two columns.
 * Three or more: a ranked list that stays readable up to the 10-seat cap.
 */
export function Scoreboard({
  state,
  selfId,
}: {
  state: PublicGameState;
  selfId: string | null;
}) {
  if (state.mode === 'p4team') {
    return (
      <div className="grid grid-cols-2 gap-6">
        {(['A', 'B'] as const).map((team, i) => {
          const members = state.players.filter((p) => p.team === team);
          const mine = members.some((p) => p.id === selfId);
          return (
            <div key={team} className={i === 1 ? 'text-right' : ''}>
              <p className="text-sm text-muted">
                Team {team}
                {mine && ' · you'}
              </p>
              <p className="font-display text-5xl font-extrabold leading-none tabular-nums">
                {formatScore(state.scores[team] ?? 0)}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {members.map((p) => {
                  const status = statusOf(p, state);
                  return (
                    <li key={p.id} className={p.lockedOut ? 'line-through' : ''}>
                      {p.name}
                      {status && ` · ${status}`}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  const me = state.players.find((p) => p.id === selfId);
  const others = state.players.filter((p) => p.id !== selfId);

  if (state.players.length === 2 && me && others[0]) {
    const them = others[0];
    return (
      <div className="flex items-end justify-between gap-4">
        {[me, them].map((p, i) => (
          <div
            key={p.id}
            className={['flex flex-col gap-0.5', i === 1 ? 'items-end text-right' : ''].join(' ')}
          >
            <span className="max-w-[9rem] truncate text-sm text-muted">
              {i === 0 ? 'You' : p.name}
            </span>
            <span
              className={[
                'font-display text-5xl font-extrabold leading-none tabular-nums',
                p.lockedOut ? 'text-muted line-through' : '',
              ].join(' ')}
            >
              {formatScore(state.scores[p.id] ?? 0)}
            </span>
            <span className="h-4 text-xs font-medium text-muted">{statusOf(p, state)}</span>
          </div>
        ))}
      </div>
    );
  }

  // Three or more: highest score first so standings read at a glance.
  const ranked = [...state.players].sort(
    (a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0),
  );

  return (
    <ol className="divide-y divide-line border-y border-ink">
      {ranked.map((p) => {
        const isSelf = p.id === selfId;
        const answering = p.id === state.activePlayerId;
        const status = statusOf(p, state);
        return (
          <li
            key={p.id}
            className={[
              'flex items-center justify-between gap-3 px-1 py-1.5 text-sm',
              answering ? 'bg-mark' : '',
              p.lockedOut ? 'text-muted' : '',
            ].join(' ')}
          >
            <span className="truncate">
              <span className={isSelf ? 'font-semibold' : ''}>{p.name}</span>
              {isSelf && <span className="text-muted"> (you)</span>}
              {status && <span className="ml-2 text-xs text-muted">{status}</span>}
            </span>
            <span className="font-display text-xl font-extrabold tabular-nums">
              {formatScore(state.scores[p.id] ?? 0)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
