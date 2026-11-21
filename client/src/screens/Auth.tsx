import { useState } from 'react';
import type { AuthApi } from '../useAuth.js';

interface Props {
  auth: AuthApi;
  onDone: () => void;
  onCancel: () => void;
  /** Open straight on the forgot-password form (from a dead reset link). */
  initialView?: 'login' | 'register' | 'forgot';
}

type View = 'login' | 'register' | 'forgot';

const PASSWORD_MIN = 8;

function Field({
  id,
  label,
  hint,
  error,
  ...input
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        className="field"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-bad">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Auth({ auth, onDone, onCancel, initialView = 'login' }: Props) {
  const [view, setView] = useState<View>(initialView);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  // Blur-first: only complain about a mismatch once the player has left the
  // confirm box (or tried to submit), and stop as soon as it matches.
  const mismatch = view === 'register' && confirmTouched && confirm !== password;

  function switchView(next: View) {
    setView(next);
    setError(null);
    setConfirmTouched(false);
    setResetSentTo(null);
  }

  async function submit() {
    setError(null);
    if (view === 'register') {
      setConfirmTouched(true);
      if (confirm !== password) return;
    }
    if (view === 'forgot' && !email.trim()) {
      setError('Enter the email you signed up with.');
      return;
    }
    setBusy(true);
    const result =
      view === 'login'
        ? await auth.login(identifier.trim(), password)
        : view === 'register'
          ? await auth.register(email.trim(), username.trim(), password)
          : await auth.requestReset(email.trim());
    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    if (view === 'forgot') setResetSentTo(email.trim());
    else onDone();
  }

  if (auth.unavailable) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
        <h1 className="text-center font-display text-4xl font-extrabold">Rated play is off</h1>
        <p className="text-center text-sm text-muted">
          This server has no database configured, so accounts and ratings are unavailable. Guest
          rooms and training still work.
        </p>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Back
        </button>
      </div>
    );
  }

  if (view === 'forgot') {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
        <header className="text-center">
          <h1 className="font-display text-4xl font-extrabold">Reset password</h1>
          <p className="mt-1 text-sm text-muted">
            We’ll email you a link to choose a new one.
          </p>
        </header>

        {resetSentTo ? (
          <div className="panel space-y-2 text-center" role="status">
            <p className="font-semibold">Check your inbox</p>
            <p className="text-sm text-muted">
              If {resetSentTo} has an account, a reset link is on its way. It works for 30
              minutes. Check spam if you don’t see it.
            </p>
          </div>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field
              id="forgot-email"
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p role="alert" className="text-center text-sm text-bad">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <button type="button" className="btn-secondary" onClick={() => switchView('login')}>
          Back to sign in
        </button>
      </div>
    );
  }

  const registering = view === 'register';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold">
          {registering ? 'Create account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-muted">Rated matches, Elo, the daily, and friends.</p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        {(['login', 'register'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={view === t}
            onClick={() => switchView(t)}
            className={`btn ${view === t ? 'bg-ink text-paper' : 'bg-tile text-ink'}`}
          >
            {t === 'login' ? 'Sign in' : 'Register'}
          </button>
        ))}
      </div>

      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {registering ? (
          <>
            <Field
              id="reg-email"
              label="Email"
              hint="Only used to sign in and reset your password. Never shown to other players."
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              id="reg-username"
              label="Username"
              hint="Shown to other players. 3–16 letters, numbers, _ or -."
              autoComplete="username"
              maxLength={16}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </>
        ) : (
          <Field
            id="login-identifier"
            label="Email or username"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        )}

        <Field
          id="password"
          label="Password"
          hint={registering ? `At least ${PASSWORD_MIN} characters.` : undefined}
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {registering && (
          <Field
            id="confirm-password"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            error={mismatch ? 'Passwords don’t match. Type the same password in both boxes.' : null}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => {
              if (confirm) setConfirmTouched(true);
            }}
          />
        )}

        {!registering && (
          <p className="text-right">
            <button
              type="button"
              className="min-h-[44px] text-sm font-semibold underline"
              onClick={() => switchView('forgot')}
            >
              Forgot password?
            </button>
          </p>
        )}

        {error && (
          <p role="alert" className="text-center text-sm text-bad">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
          {busy ? 'Working…' : registering ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button type="button" className="btn-secondary" onClick={onCancel}>
        Back
      </button>
    </div>
  );
}
