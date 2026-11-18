import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DAILY_RULES,
  HAND_IDLE_TIMEOUT_MS,
  HANDS_PER_MATCH,
  dailyKey,
  dailyNumber,
  dailyShareText,
  dealDaily,
  formatDailyTime,
  scoreDaily,
  type DailyFriendView,
  type DailyHandRecord,
  type DailyResultView,
  type DailyTodayView,
} from '@24game/shared';
import { apiDelete, apiGet, apiPost } from '../api.js';
import { SoloBoard } from '../components/SoloBoard.js';
import { useTraining } from '../training.js';
import type { AuthApi } from '../useAuth.js';

// ------------------------------------------------------------ local progress

/**
 * Progress lives in localStorage so a refresh resumes where you left off. A
 * hand that was dealt but never finished counts as missed on resume, so
 * reloading is never a way to see the cards and try again.
 */
interface LocalDaily {
  records: DailyHandRecord[];
  /** Index of the hand on screen, or null between hands. */
  dealtHand: number | null;
}

/** Progress is per account (or "guest") so a shared device never mixes runs. */
const storageKey = (day: string, owner: string) => `24game.daily.${day}.${owner}`;

function loadLocal(day: string, owner: string): LocalDaily {
  try {
    const raw = localStorage.getItem(storageKey(day, owner));
    if (raw) return JSON.parse(raw) as LocalDaily;
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return { records: [], dealtHand: null };
}

function saveLocal(day: string, owner: string, value: LocalDaily): void {
  try {
    localStorage.setItem(storageKey(day, owner), JSON.stringify(value));
  } catch {
    // Private mode: progress just won't survive a refresh.
  }
}

/**
 * Load an account's progress. A guest run on this device is claimed by the
 * first account that signs in without progress of its own, then cleared.
 */
function loadFor(day: string, owner: string): LocalDaily {
  const own = loadLocal(day, owner);
  if (owner === 'guest' || own.records.length > 0) return own;
  const guest = loadLocal(day, 'guest');
  if (guest.records.length === 0) return own;
  saveLocal(day, owner, guest);
  try {
    localStorage.removeItem(storageKey(day, 'guest'));
  } catch {
    // Ignore: worst case the guest copy lingers.
  }
  return guest;
}

/** Fold an abandoned hand into the records as a miss. */
function settleAbandoned(local: LocalDaily): LocalDaily {
  if (local.dealtHand === null || local.dealtHand !== local.records.length) return local;
  return {
    records: [...local.records, { steps: null, noSolution: false, ms: HAND_IDLE_TIMEOUT_MS }],
    dealtHand: null,
  };
}

// --------------------------------------------------------------- pieces

function ResultGrid({ hands }: { hands: readonly boolean[] }) {
  return (
    <div className="flex justify-center gap-1" aria-label={`${hands.filter(Boolean).length} of ${hands.length} hands right`}>
      {hands.map((ok, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-4 w-4 rounded-sm border-2 border-ink ${ok ? 'bg-ink' : 'bg-card'}`}
        />
      ))}
    </div>
  );
}

function ResultCard({ day, result }: { day: string; result: DailyResultView }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    try {
      await navigator.clipboard.writeText(dailyShareText(day, result));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; nothing else to do.
    }
  }
  return (
    <div className="panel flex flex-col items-center gap-3 text-center">
      <p className="eyebrow">Your result</p>
      <p className="font-display text-6xl font-extrabold leading-none tabular-nums">
        {result.correct}
        <span className="text-3xl text-muted">/{result.hands.length}</span>
      </p>
      <p className="text-sm text-muted">Time {formatDailyTime(result.timeMs)}</p>
      <ResultGrid hands={result.hands} />
      <button type="button" className="btn-secondary w-full" onClick={() => void share()}>
        {copied ? 'Copied' : 'Copy result to share'}
      </button>
    </div>
  );
}

function FriendRow({
  friend,
  onRemove,
}: {
  friend: DailyFriendView;
  onRemove: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { wins, losses, ties } = friend.record;
  const today = friend.result
    ? `${friend.result.correct}/${friend.result.hands.length} · ${formatDailyTime(friend.result.timeMs)}`
    : friend.played
      ? 'Played. Finish yours to see it.'
      : 'Not played yet';

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-semibold">{friend.username}</p>
        <p className="text-sm text-muted">{today}</p>
        <p className="text-xs text-muted">
          You {wins}–{losses}
          {ties > 0 && `–${ties}`} all time
        </p>
      </div>
      {confirming ? (
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            className="btn-danger min-h-[44px] px-3 text-sm"
            onClick={() => onRemove(friend.userId)}
          >
            Remove {friend.username}
          </button>
          <button
            type="button"
            className="btn-secondary min-h-[44px] px-3 text-sm"
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="min-h-[44px] shrink-0 px-2 text-sm text-muted underline"
          onClick={() => setConfirming(true)}
        >
          Remove
        </button>
      )}
    </li>
  );
}

// --------------------------------------------------------------- play

function DailyPlay({
  day,
  owner,
  initial,
  onFinished,
  onExit,
}: {
  day: string;
  owner: string;
  initial: LocalDaily;
  onFinished: (records: DailyHandRecord[]) => void;
  onExit: () => void;
}) {
  const local = useRef<LocalDaily>(initial);
  const hands = useMemo(() => dealDaily(day), [day]);

  const { game, state } = useTraining(DAILY_RULES, {
    hands,
    completed: initial.records,
    onHandStart: (index) => {
      local.current = { ...local.current, dealtHand: index };
      saveLocal(day, owner, local.current);
    },
    onHandEnd: (index, record) => {
      if (index !== local.current.records.length) return;
      local.current = { records: [...local.current.records, record], dealtHand: null };
      saveLocal(day, owner, local.current);
    },
  });

  useEffect(() => {
    if (state.phase === 'done') onFinished(local.current.records);
  }, [state.phase, onFinished]);

  const score = scoreDaily(day, local.current.records);

  return (
    <SoloBoard
      game={game}
      state={state}
      header={
        <header className="flex h-11 items-center justify-between border-b border-ink text-sm">
          <button
            type="button"
            className="-ml-1 min-h-[44px] px-1 font-semibold underline"
            onClick={onExit}
          >
            Pause
          </button>
          <span className="font-display text-xl font-extrabold">Daily #{dailyNumber(day)}</span>
          <span className="font-semibold tabular-nums">
            {Math.min(state.handNumber, HANDS_PER_MATCH)}/{HANDS_PER_MATCH}
          </span>
        </header>
      }
      above={
        <p className="text-center text-sm text-muted">
          {score.correct} right so far · same 13 hands for everyone today
        </p>
      }
    />
  );
}

// --------------------------------------------------------------- screen

export function Daily({
  auth,
  onExit,
  onSignIn,
}: {
  auth: AuthApi;
  onExit: () => void;
  onSignIn: () => void;
}) {
  const day = useMemo(() => dailyKey(), []);
  const owner = auth.user?.id ?? 'guest';
  const [local, setLocal] = useState<LocalDaily>(() => settleAbandoned(loadFor(day, owner)));
  // Signing in or out mid-screen switches whose progress is shown.
  useEffect(() => {
    setLocal(settleAbandoned(loadFor(day, owner)));
  }, [day, owner]);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<DailyTodayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendName, setFriendName] = useState('');
  const [friendError, setFriendError] = useState<string | null>(null);
  const signedIn = Boolean(auth.token && auth.user);

  const finished = local.records.length >= HANDS_PER_MATCH;
  const localScore = finished ? scoreDaily(day, local.records) : null;
  const myResult: DailyResultView | null = view?.mine ?? localScore;

  const refresh = useCallback(async () => {
    setView(null);
    if (!auth.token) return;
    const res = await apiGet<DailyTodayView>('/api/daily/today', auth.token);
    if (res.ok) setView(res.data);
    else if (res.status !== 503) setError(res.error);
  }, [auth.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Save a finished run once: on finishing, or later after signing in.
  const submitting = useRef(false);
  useEffect(() => {
    if (!signedIn || !finished || !view || view.mine || submitting.current) return;
    submitting.current = true;
    void (async () => {
      const res = await apiPost<DailyTodayView>(
        '/api/daily/submit',
        { day, hands: local.records },
        auth.token,
      );
      submitting.current = false;
      if (res.ok) setView(res.data);
      else if (res.status === 409) void refresh();
      else setError(res.error);
    })();
  }, [signedIn, finished, view, day, local.records, auth.token, refresh]);

  const onFinished = useCallback(
    (records: DailyHandRecord[]) => {
      setLocal({ records, dealtHand: null });
      setPlaying(false);
    },
    [],
  );

  async function addFriend() {
    if (!friendName.trim()) {
      setFriendError('Enter your friend’s username.');
      return;
    }
    const res = await apiPost<DailyTodayView>('/api/friends', { username: friendName }, auth.token);
    if (res.ok) {
      setView(res.data);
      setFriendName('');
      setFriendError(null);
    } else {
      setFriendError(res.error);
    }
  }

  async function removeFriend(userId: string) {
    const res = await apiDelete<DailyTodayView>(`/api/friends/${userId}`, auth.token);
    if (res.ok) setView(res.data);
    else setError(res.error);
  }

  if (playing) {
    return (
      <DailyPlay
        day={day}
        owner={owner}
        initial={local}
        onFinished={onFinished}
        onExit={() => {
          setLocal(settleAbandoned(loadFor(day, owner)));
          setPlaying(false);
        }}
      />
    );
  }

  const started = local.records.length > 0;
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-5 px-5 pb-8 pt-3">
      <header className="flex h-11 items-center justify-between border-b border-ink">
        <button
          type="button"
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center"
          onClick={onExit}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <span className="font-display text-xl font-extrabold">Daily #{dailyNumber(day)}</span>
        <span className="whitespace-nowrap text-right text-sm text-muted">{date}</span>
      </header>

      {myResult ? (
        <ResultCard day={day} result={myResult} />
      ) : (
        <div className="flex flex-col gap-3 pt-4 text-center">
          <h1 className="font-display text-4xl font-extrabold">Today’s 24</h1>
          <p className="text-muted">
            Same 13 hands for everyone, one try a day. Most hands right wins; time breaks ties.
            New deck at midnight UTC.
          </p>
          <button type="button" className="btn-primary mt-2 h-14 text-lg" onClick={() => setPlaying(true)}>
            {started ? `Resume at hand ${local.records.length + 1}` : 'Play today’s daily'}
          </button>
          {started && (
            <p className="text-xs text-muted">A hand you left mid-way counts as missed.</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-bad">
          {error}
        </p>
      )}

      {signedIn ? (
        view && (
          <section className="flex flex-col gap-3">
            <h2 className="rule pt-4 font-display text-2xl font-extrabold">Friends</h2>
            {view.friends.length === 0 ? (
              <p className="text-sm text-muted">
                Add a friend by username to see their daily score next to yours, and your
                record against them day after day.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {view.friends.map((f) => (
                  <FriendRow key={f.userId} friend={f} onRemove={(id) => void removeFriend(id)} />
                ))}
              </ul>
            )}
            <div>
              <label htmlFor="friend-username" className="mb-1.5 block text-sm font-semibold">
                Add a friend
              </label>
              <div className="flex gap-2">
                <input
                  id="friend-username"
                  className="field flex-1"
                  autoComplete="off"
                  placeholder="Username"
                  value={friendName}
                  onChange={(e) => {
                    setFriendName(e.target.value);
                    setFriendError(null);
                  }}
                />
                <button type="button" className="btn-primary" onClick={() => void addFriend()}>
                  Add
                </button>
              </div>
              {friendError && (
                <p role="alert" className="mt-1.5 text-sm text-bad">
                  {friendError}
                </p>
              )}
            </div>
          </section>
        )
      ) : (
        <div className="rule flex flex-col gap-3 pt-4 text-center">
          <p className="text-sm text-muted">
            Sign in to save your result and see how your friends did, day after day.
          </p>
          <button type="button" className="btn-secondary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}
    </div>
  );
}
