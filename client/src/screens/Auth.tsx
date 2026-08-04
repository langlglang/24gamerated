import { useState } from 'react';
import type { AuthApi } from '../useAuth.js';

interface Props {
  auth: AuthApi;
  onDone: () => void;
  onCancel: () => void;
}

export function Auth({ auth, onDone, onCancel }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result =
      tab === 'login'
        ? await auth.login(identifier.trim(), password)
        : await auth.register(email.trim(), username.trim(), password);
    setBusy(false);
    if (result) setError(result);
    else onDone();
  }

  if (auth.unavailable) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
        <h1 className="text-center text-3xl font-black text-emerald-400">Rated play is off</h1>
        <p className="text-center text-sm text-slate-400">
          This server has no database configured, so accounts and ratings are unavailable. Guest
          rooms and training still work.
        </p>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
      <header className="text-center">
        <h1 className="text-4xl font-black text-emerald-400">
          {tab === 'login' ? 'Sign in' : 'Create account'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">Rated matches, Elo, and friend challenges.</p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        {(['login', 'register'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            className={`btn ${tab === t ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
          >
            {t === 'login' ? 'Sign in' : 'Register'}
          </button>
        ))}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {tab === 'login' ? (
          <input
            className="field"
            placeholder="Email or username"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        ) : (
          <>
            <input
              className="field"
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field"
              placeholder="Username (shown to other players)"
              autoComplete="username"
              maxLength={16}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </>
        )}

        <input
          className="field"
          placeholder="Password"
          type="password"
          autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-center text-sm text-rose-400">{error}</p>}

        <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
          {busy ? 'Working…' : tab === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {tab === 'register' && (
        <p className="text-center text-xs text-slate-500">
          Your email is only used to identify your account — it is never shown to other players.
        </p>
      )}

      <button type="button" className="btn-secondary" onClick={onCancel}>
        Back
      </button>
    </div>
  );
}
