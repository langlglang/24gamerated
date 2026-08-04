import { useEffect, useState } from 'react';
import {
  PROVISIONAL_GAMES,
  formatDelta,
  type LeaderboardEntryView,
  type MatchHistoryEntryView,
} from '@24game/shared';
import { apiGet } from '../api.js';
import type { GameApi } from '../useGame.js';
import type { AuthApi } from '../useAuth.js';

interface Props {
  game: GameApi;
  auth: AuthApi;
  onBack: () => void;
}

function RatingBadge({ rating, provisional }: { rating: number; provisional: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-3xl font-black tabular-nums text-emerald-400">{rating}</span>
      {provisional && <span className="text-xs uppercase text-amber-400">provisional</span>}
    </span>
  );
}

function Searching({ game }: { game: GameApi }) {
  const [elapsed, setElapsed] = useState(game.queue.waitingMs);

  useEffect(() => {
    setElapsed(game.queue.waitingMs);
    const id = setInterval(() => setElapsed((ms) => ms + 1000), 1000);
    return () => clearInterval(id);
  }, [game.queue.waitingMs]);

  return (
    <div className="panel space-y-3 text-center">
      <p className="text-lg font-semibold">Searching for an opponent…</p>
      <p className="text-sm text-slate-400">
        {Math.floor(elapsed / 1000)}s · {game.queue.searching} searching · accepting ±
        {game.queue.band} rating
      </p>
      <p className="text-xs text-slate-500">
        The rating window widens the longer you wait, so this always finds someone eventually.
      </p>
      <button type="button" className="btn-secondary w-full" onClick={game.leaveQueue}>
        Cancel search
      </button>
    </div>
  );
}

export function Ranked({ game, auth, onBack }: Props) {
  const me = game.profile ?? auth.user;
  const [challengeName, setChallengeName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntryView[]>([]);
  const [history, setHistory] = useState<MatchHistoryEntryView[]>([]);

  // Refresh standings whenever the player's own record changes — that only
  // happens after a rated match, which is exactly when both are stale.
  const ratedGames = me?.ratedGames ?? 0;
  useEffect(() => {
    void (async () => {
      const board = await apiGet<{ entries: LeaderboardEntryView[] }>('/api/leaderboard');
      if (board.ok) setLeaders(board.data.entries);
      const mine = await apiGet<{ matches: MatchHistoryEntryView[] }>(
        '/api/me/matches',
        auth.token,
      );
      if (mine.ok) setHistory(mine.data.matches);
    })();
  }, [auth.token, ratedGames]);

  async function challenge() {
    const name = challengeName.trim();
    if (!name) return;
    const error = await game.sendChallenge(name);
    setNotice(error ?? `Challenge sent to ${name}.`);
    if (!error) setChallengeName('');
  }

  if (!me) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 p-5">
        <p className="text-center text-slate-400">Loading your profile…</p>
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <button type="button" className="text-sm text-slate-400 underline" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="text-sm text-slate-500 underline"
          onClick={() => {
            auth.logout();
            onBack();
          }}
        >
          Sign out
        </button>
      </header>

      <div className="panel">
        <p className="text-xs uppercase tracking-widest text-slate-500">Signed in as</p>
        <p className="text-xl font-bold">{me.username}</p>
        <div className="mt-2 flex items-end justify-between">
          <RatingBadge rating={me.rating} provisional={me.provisional} />
          <p className="text-right text-xs text-slate-400">
            {me.wins}W · {me.losses}L{me.draws > 0 && ` · ${me.draws}D`}
            <br />
            {me.ratedGames} rated {me.ratedGames === 1 ? 'game' : 'games'}
          </p>
        </div>
        {me.provisional && (
          <p className="mt-2 text-xs text-slate-500">
            Your rating moves faster for the first {PROVISIONAL_GAMES} games while it settles.
          </p>
        )}
      </div>

      {game.challenges.length > 0 && (
        <div className="panel space-y-2 border-amber-500/60">
          <p className="text-sm font-semibold text-amber-400">Incoming challenges</p>
          {game.challenges.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">
                <span className="font-semibold">{c.fromUsername}</span>
                <span className="text-slate-500"> ({c.fromRating})</span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary px-3 py-1.5 text-sm"
                  onClick={() => void game.respondChallenge(c.id, true)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-sm"
                  onClick={() => void game.respondChallenge(c.id, false)}
                >
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {game.queue.inQueue ? (
        <Searching game={game} />
      ) : (
        <button
          type="button"
          className="btn-primary h-16 text-xl"
          onClick={() => {
            void game.joinQueue().then((err) => err && setNotice(err));
          }}
        >
          Play ranked
        </button>
      )}

      <div className="panel space-y-2">
        <p className="text-sm font-semibold text-slate-300">Challenge a friend</p>
        <div className="flex gap-2">
          <input
            className="field flex-1"
            placeholder="Their username"
            maxLength={16}
            value={challengeName}
            onChange={(e) => setChallengeName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void challenge()}
          />
          <button type="button" className="btn-secondary" onClick={() => void challenge()}>
            Send
          </button>
        </div>
        <p className="text-xs text-slate-500">
          They have to be online. Friend challenges are rated the same as ranked games.
        </p>
        {notice && <p className="text-sm text-amber-400">{notice}</p>}
      </div>

      {history.length > 0 && (
        <div className="panel">
          <p className="mb-2 text-sm font-semibold text-slate-300">Recent matches</p>
          <ul className="space-y-1 text-sm">
            {history.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  <span
                    className={
                      m.result === 'win'
                        ? 'text-emerald-400'
                        : m.result === 'loss'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                    }
                  >
                    {m.result === 'win' ? 'W' : m.result === 'loss' ? 'L' : 'D'}
                  </span>{' '}
                  vs {m.opponent}
                  <span className="text-slate-500">
                    {' '}
                    {m.yourScore}–{m.theirScore}
                  </span>
                </span>
                <span
                  className={`tabular-nums ${m.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {formatDelta(m.delta)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {leaders.length > 0 && (
        <div className="panel">
          <p className="mb-2 text-sm font-semibold text-slate-300">Leaderboard</p>
          <ul className="space-y-1 text-sm">
            {leaders.map((entry) => (
              <li
                key={entry.id}
                className={`flex items-baseline justify-between gap-2 ${
                  entry.id === me.id ? 'font-semibold text-emerald-400' : ''
                }`}
              >
                <span className="truncate">
                  <span className="mr-2 tabular-nums text-slate-500">{entry.rank}</span>
                  {entry.username}
                  {entry.provisional && <span className="ml-1 text-xs text-amber-500">?</span>}
                </span>
                <span className="tabular-nums">{entry.rating}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
