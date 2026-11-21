import { useState } from 'react';
import type { AuthApi } from '../useAuth.js';

/** Opened from the emailed link (?reset=<token>). Signs the player in on success. */
export function ResetPassword({
  auth,
  token,
  onDone,
  onRequestNew,
}: {
  auth: AuthApi;
  token: string;
  onDone: () => void;
  onRequestNew: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmTouched && confirm !== password;

  async function submit() {
    setConfirmTouched(true);
    if (confirm !== password) return;
    setBusy(true);
    setError(null);
    const result = await auth.resetPassword(token, password);
    setBusy(false);
    if (result) setError(result);
    else onDone();
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 p-5">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted">You’ll be signed in when it’s saved.</p>
      </header>

      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold">
            New password
          </label>
          <input
            id="new-password"
            className="field"
            type="password"
            autoComplete="new-password"
            aria-describedby="new-password-hint"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
          <p id="new-password-hint" className="mt-1.5 text-xs text-muted">
            At least 8 characters.
          </p>
        </div>
        <div>
          <label htmlFor="new-password-confirm" className="mb-1.5 block text-sm font-semibold">
            Confirm new password
          </label>
          <input
            id="new-password-confirm"
            className="field"
            type="password"
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? 'new-password-confirm-error' : undefined}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => {
              if (confirm) setConfirmTouched(true);
            }}
          />
          {mismatch && (
            <p id="new-password-confirm-error" className="mt-1.5 text-sm text-bad">
              Passwords don’t match. Type the same password in both boxes.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-center text-sm text-bad">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>

      {error && (
        <button type="button" className="btn-secondary" onClick={onRequestNew}>
          Request a new link
        </button>
      )}
    </div>
  );
}
