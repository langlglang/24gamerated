import { useEffect, useState } from 'react';
import {
  DEFAULT_RULES,
  MAX_FFA_PLAYERS,
  dailyKey,
  dailyNumber,
  type GameMode,
  type PublicUserView,
  type RuleSet,
} from '@24game/shared';
import { RuleToggles } from '../components/RuleToggles.js';

interface Props {
  /** From a shared /room/CODE link: open the join form with the code filled in. */
  initialJoinCode?: string | null;
  onCreate: (name: string, mode: GameMode, rules: RuleSet) => Promise<string | null>;
  onJoin: (name: string, code: string) => Promise<string | null>;
  onTraining: () => void;
  onDaily: () => void;
  onRanked: () => void;
  connected: boolean;
  user: PublicUserView | null;
  authLoading: boolean;
}

const MODES: { id: GameMode; label: string; blurb: string }[] = [
  {
    id: 'ffa',
    label: 'Everyone for themselves',
    blurb: `2 to ${MAX_FFA_PLAYERS} players. Start whenever you're ready.`,
  },
  { id: 'p4team', label: 'Teams', blurb: 'Exactly 4 players, 2 v 2.' },
];

export function Home({
  initialJoinCode,
  onCreate,
  onJoin,
  onTraining,
  onDaily,
  onRanked,
  connected,
  user,
  authLoading,
}: Props) {
  const [view, setView] = useState<'menu' | 'create' | 'join'>(initialJoinCode ? 'join' : 'menu');
  const [name, setName] = useState(user?.username ?? '');
  const [code, setCode] = useState(initialJoinCode ?? '');
  const [mode, setMode] = useState<GameMode>('ffa');
  const [rules, setRules] = useState<RuleSet>(DEFAULT_RULES);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The profile usually arrives after first render; prefill once it does,
  // without overwriting anything the player has already typed.
  const username = user?.username;
  useEffect(() => {
    if (username) setName((current) => current || username);
  }, [username]);

  async function submit() {
    if (!name.trim()) {
      setError('Add a display name so other players know who you are.');
      return;
    }
    if (view === 'join' && !code.trim()) {
      setError('Enter the room code from the host.');
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      view === 'create' ? await onCreate(name.trim(), mode, rules) : await onJoin(name.trim(), code);
    setBusy(false);
    if (result) setError(result);
  }

  if (view !== 'menu') {
    const creating = view === 'create';
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-5 px-5 pb-8 pt-3">
        <header className="flex h-11 items-center justify-between border-b border-ink">
          <button
            type="button"
            aria-label="Back"
            className="-ml-2 flex h-11 w-11 items-center justify-center"
            onClick={() => {
              setView('menu');
              setError(null);
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span className="font-display text-xl font-extrabold">
            {creating ? 'New room' : 'Join a room'}
          </span>
          <span className="w-11" />
        </header>

        <div>
          <label htmlFor="display-name" className="mb-1.5 block text-sm font-semibold">
            Display name
          </label>
          <input
            id="display-name"
            className="field text-lg"
            maxLength={20}
            autoComplete="nickname"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </div>

        {creating ? (
          <>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">Mode</legend>
              <div className="space-y-2">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={mode === m.id}
                    onClick={() => setMode(m.id)}
                    className={[
                      'flex w-full flex-col rounded-md border-2 px-4 py-3 text-left transition-colors',
                      mode === m.id ? 'border-ink bg-card' : 'border-line hover:border-ink',
                    ].join(' ')}
                  >
                    <span className="font-semibold">{m.label}</span>
                    <span className="text-sm text-muted">{m.blurb}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <RuleToggles rules={rules} onChange={setRules} disabled={false} />
          </>
        ) : (
          <div>
            <label htmlFor="room-code" className="mb-1.5 block text-sm font-semibold">
              Room code
            </label>
            <input
              id="room-code"
              className="field text-center text-2xl font-bold uppercase tracking-[0.4em]"
              maxLength={7}
              autoComplete="off"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
            />
          </div>
        )}

        <p role="alert" className="min-h-5 text-center text-sm text-bad">
          {error}
        </p>

        <button
          type="button"
          className="btn-primary mt-auto h-14 text-lg"
          disabled={busy || !connected}
          onClick={() => void submit()}
        >
          {!connected ? 'Connecting…' : creating ? 'Create room' : 'Join room'}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 pb-8 pt-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{connected ? 'Online' : 'Connecting…'}</span>
        {user ? (
          <button type="button" className="font-semibold underline" onClick={onRanked}>
            {user.username} · {user.rating}
          </button>
        ) : (
          <button
            type="button"
            className="font-semibold underline disabled:opacity-40"
            disabled={authLoading}
            onClick={onRanked}
          >
            Sign in
          </button>
        )}
      </div>

      <header className="flex flex-col items-center gap-3 pt-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-lg border-[3px] border-ink bg-card">
          <span className="font-display text-5xl font-extrabold">24</span>
        </div>
        <h1 className="font-display text-4xl font-extrabold">Twenty-Four</h1>
        <p className="max-w-[18rem] text-muted">
          Four cards. Four operations. Make exactly 24 before anyone else.
        </p>
      </header>

      <div className="flex flex-col gap-3 pt-2">
        <button
          type="button"
          className="btn-primary h-14 text-lg"
          disabled={authLoading}
          onClick={onRanked}
        >
          {user ? 'Play ranked' : 'Sign in to play ranked'}
        </button>
        <button type="button" className="btn-secondary h-14 text-lg" onClick={onDaily}>
          Daily puzzle <span className="ml-2 font-normal text-muted">#{dailyNumber(dailyKey())}</span>
        </button>
        <button type="button" className="btn-secondary h-14 text-lg" onClick={() => setView('create')}>
          Play with friends
        </button>
        <button type="button" className="btn-secondary h-14 text-lg" onClick={onTraining}>
          Practice
        </button>
      </div>

      {user && (
        <div className="rule flex items-center justify-between pt-4">
          <span className="text-sm text-muted">Your rating</span>
          <span className="font-display text-3xl font-extrabold tabular-nums">{user.rating}</span>
        </div>
      )}

      <p className="mt-auto flex items-center justify-center gap-2 text-sm text-muted">
        Have a room code?
        <button type="button" className="font-semibold text-ink underline" onClick={() => setView('join')}>
          Join a room
        </button>
      </p>
      <p className="flex items-center justify-center gap-4 text-xs text-muted">
        <a href="/privacy" className="min-h-[44px] content-center underline">
          Privacy
        </a>
        <a href="/terms" className="min-h-[44px] content-center underline">
          Terms
        </a>
      </p>
    </div>
  );
}
