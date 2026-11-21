import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PUZZLE_RULES,
  applyCombine,
  checkPuzzleSolution,
  dailyKey,
  formatDailyTime,
  puzzleShareText,
  tableFromCards,
  type CombineStep,
  type DailyPuzzleView,
  type DailyStatsView,
  type SolveTimeBucket,
  type TableCard,
} from '@24game/shared';
import { apiGet, apiPost } from '../api.js';
import { CombineBoard } from '../components/CombineBoard.js';
import type { AuthApi } from '../useAuth.js';

// ------------------------------------------------------------ local progress

/**
 * The clock and any solve live in localStorage, per day and per account
 * ("guest" when signed out), so a refresh never resets the clock.
 */
interface LocalPuzzle {
  startedAt: number;
  solved: { timeMs: number; steps: CombineStep[] } | null;
  /** The server has recorded this solve (signed-in only). */
  submitted: boolean;
  /** The server definitively refused this solve (4xx other than 401): don't re-POST. */
  submitError?: string | null;
}

const storageKey = (day: string, owner: string) => `24game.puzzle.${day}.${owner}`;

function loadLocal(day: string, owner: string): LocalPuzzle | null {
  try {
    const raw = localStorage.getItem(storageKey(day, owner));
    if (raw) return JSON.parse(raw) as LocalPuzzle;
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return null;
}

function saveLocal(day: string, owner: string, value: LocalPuzzle): void {
  try {
    localStorage.setItem(storageKey(day, owner), JSON.stringify(value));
  } catch {
    // Private mode: the clock just won't survive a refresh.
  }
}

/**
 * An account with no progress of its own claims a guest run from this device
 * (so a guest who solves, then signs in, gets counted), then the guest copy
 * is cleared.
 */
function loadFor(day: string, owner: string): LocalPuzzle | null {
  const own = loadLocal(day, owner);
  if (owner === 'guest') return own;
  const guest = loadLocal(day, 'guest');
  // Only a guest run with a solve or a start is worth claiming.
  if (!guest || (!guest.solved && !guest.startedAt)) return own;
  // Keep the account's own copy unless the guest solved and the account hasn't.
  if (own && !(guest.solved && !own.solved)) return own;
  const claimed: LocalPuzzle = { ...guest, submitted: false, submitError: null };
  saveLocal(day, owner, claimed);
  try {
    localStorage.removeItem(storageKey(day, 'guest'));
  } catch {
    // Ignore: worst case the guest copy lingers.
  }
  return claimed;
}

// ------------------------------------------------------------ helpers

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}

/** m:ss for axis ticks. */
function shortTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Replay steps from the deal; null if any step no longer applies. */
function replay(view: DailyPuzzleView, steps: readonly CombineStep[]): TableCard[] | null {
  let table = tableFromCards(view.cards);
  for (const [i, step] of steps.entries()) {
    const r = applyCombine(table, step, PUZZLE_RULES, i);
    if (!r.ok) return null;
    table = r.table;
  }
  return table;
}

/** Approximate share of recorded solvers slower than `timeMs`, from buckets. */
function approxFasterThan(stats: DailyStatsView, timeMs: number): number | null {
  if (stats.solvers === 0) return null;
  let slower = 0;
  for (const b of stats.buckets) {
    if (b.fromMs >= timeMs) slower += b.count;
    else if (b.toMs > timeMs) slower += (b.count * (b.toMs - timeMs)) / Math.max(1, b.toMs - b.fromMs);
  }
  return Math.max(0, Math.min(100, Math.round((slower / stats.solvers) * 100)));
}

/** Fractional bucket position of a time on the evenly spaced x axis. */
function bucketPosition(buckets: readonly SolveTimeBucket[], timeMs: number): number {
  if (buckets.length === 0) return 0;
  if (timeMs <= buckets[0]!.fromMs) return 0;
  for (const [i, b] of buckets.entries()) {
    if (timeMs < b.toMs) return i + (timeMs - b.fromMs) / Math.max(1, b.toMs - b.fromMs);
  }
  return buckets.length;
}

// ------------------------------------------------------------ screen

interface Props {
  auth: AuthApi;
  onExit: () => void;
  onSignIn: () => void;
}

type StatsState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ready'; stats: DailyStatsView }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

export function Daily({ auth, onExit, onSignIn }: Props) {
  const [puzzle, setPuzzle] = useState<DailyPuzzleView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const owner = auth.user?.id ?? 'guest';
  const signedIn = Boolean(auth.user && auth.token);

  const token = auth.token;
  const loadSeq = useRef(0);
  const [newDayOut, setNewDayOut] = useState(false);
  const [solvedNow, setSolvedNow] = useState(false);

  // Fetched with the token so the server starts this account's clock.
  const loadPuzzle = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoadError(null);
    const res = await apiGet<DailyPuzzleView>('/api/daily/puzzle', token);
    if (seq !== loadSeq.current) return;
    if (res.ok) {
      setPuzzle(res.data);
      setNewDayOut(false);
    } else setLoadError('Today’s puzzle didn’t load. Check your connection and try again.');
  }, [token]);

  // Wait for auth, then (re)fetch whenever the signed-in account changes.
  useEffect(() => {
    if (auth.loading) return;
    void loadPuzzle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, owner]);

  // Midnight UTC while the page is open: offer today's puzzle, don't swap it in.
  useEffect(() => {
    if (!puzzle) return;
    const check = () => setNewDayOut(dailyKey() !== puzzle.day);
    check();
    const id = window.setInterval(check, 30_000);
    return () => window.clearInterval(id);
  }, [puzzle]);

  const date = puzzle
    ? new Date(`${puzzle.day}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-5 pb-8 pt-3">
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
        <span className="font-display text-xl font-extrabold">
          Daily{puzzle ? ` #${puzzle.number}` : ''}
        </span>
        <span className="min-w-11 whitespace-nowrap text-right text-sm text-muted">{date}</span>
      </header>

      {loadError ? (
        <div className="flex flex-col items-center gap-4 pt-10 text-center">
          <p role="alert" className="text-bad">{loadError}</p>
          <button type="button" className="btn-primary h-12 px-6" onClick={() => void loadPuzzle()}>
            Try again
          </button>
        </div>
      ) : !puzzle || auth.loading ? (
        <p className="pt-10 text-center text-muted" role="status">Loading today’s puzzle…</p>
      ) : (
        <>
          {newDayOut && !solvedNow && (
            <div className="panel flex items-center justify-between gap-3 p-3" role="status">
              <p className="text-sm">A new puzzle is out.</p>
              <button type="button" className="btn-secondary h-11 px-4 text-sm" onClick={() => void loadPuzzle()}>
                Load today’s puzzle
              </button>
            </div>
          )}
          <PuzzleGame
            key={`${puzzle.day}.${owner}`}
            puzzle={puzzle}
            owner={owner}
            signedIn={signedIn}
            token={auth.token}
            onSignIn={onSignIn}
            onSolvedChange={setSolvedNow}
          />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ play + result

interface GameProps {
  puzzle: DailyPuzzleView;
  owner: string;
  signedIn: boolean;
  token: string | null;
  onSignIn: () => void;
  onSolvedChange: (solved: boolean) => void;
}

function PuzzleGame({ puzzle, owner, signedIn, token, onSignIn, onSolvedChange }: GameProps) {
  const [local, setLocal] = useState<LocalPuzzle>(() => {
    const stored = loadFor(puzzle.day, owner);
    if (stored) return stored;
    const fresh: LocalPuzzle = { startedAt: Date.now(), solved: null, submitted: false };
    saveLocal(puzzle.day, owner, fresh);
    return fresh;
  });

  const update = useCallback(
    (next: LocalPuzzle) => {
      saveLocal(puzzle.day, owner, next);
      setLocal(next);
    },
    [puzzle.day, owner],
  );

  const isSolved = Boolean(local.solved);
  useEffect(() => onSolvedChange(isSolved), [isSolved, onSolvedChange]);

  if (local.solved) {
    return (
      <Solved
        puzzle={puzzle}
        local={local}
        solved={local.solved}
        signedIn={signedIn}
        token={token}
        onSignIn={onSignIn}
        onSubmitted={(timeMs) =>
          update({
            ...local,
            solved: local.solved && timeMs !== undefined ? { ...local.solved, timeMs } : local.solved,
            submitted: true,
            submitError: null,
          })
        }
        onSubmitError={(message) => update({ ...local, submitError: message })}
      />
    );
  }

  return (
    <Play
      puzzle={puzzle}
      startedAt={local.startedAt}
      onSolved={(steps) =>
        update({ ...local, solved: { timeMs: Date.now() - local.startedAt, steps }, submitted: false })
      }
    />
  );
}

function Play({
  puzzle,
  startedAt,
  onSolved,
}: {
  puzzle: DailyPuzzleView;
  startedAt: number;
  onSolved: (steps: CombineStep[]) => void;
}) {
  const [steps, setSteps] = useState<CombineStep[]>([]);
  const [error, setError] = useState<{ nonce: number; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const table = useMemo(() => replay(puzzle, steps) ?? tableFromCards(puzzle.cards), [puzzle, steps]);
  const finalCard = table.length === 1 ? table[0]! : null;
  const missed = finalCard !== null && !checkPuzzleSolution({ ...puzzle, ways: 0 }, steps).ok;

  function combine(step: CombineStep) {
    const r = applyCombine(table, step, PUZZLE_RULES, steps.length);
    if (!r.ok) {
      setError((e) => ({
        nonce: (e?.nonce ?? 0) + 1,
        message: r.error === 'div-by-zero' ? 'You can’t divide by zero.' : 'That move doesn’t work. Try another.',
      }));
      return;
    }
    const next = [...steps, step];
    setError(null);
    setSteps(next);
    if (r.table.length === 1 && checkPuzzleSolution({ ...puzzle, ways: 0 }, next).ok) onSolved(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Use every card</p>
          <h1 className="font-display text-5xl font-extrabold leading-none">
            Make <span className="tabular-nums">{puzzle.target}</span>
          </h1>
        </div>
        <p className="font-display text-2xl font-bold tabular-nums" aria-label={`Time ${formatClock(now - startedAt)}`}>
          {formatClock(now - startedAt)}
        </p>
      </div>

      <CombineBoard
        dealt={puzzle.cards}
        table={table}
        interactive={!missed}
        onCombine={combine}
        errorNonce={error?.nonce ?? 0}
        errorMessage={error?.message ?? null}
        columns={3}
      />

      <p role="status" aria-live="polite" className="text-center font-medium empty:hidden">
        {missed && finalCard ? `That makes ${finalCard.label} — not ${puzzle.target}. Try again.` : ''}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className="btn-secondary h-12"
          disabled={steps.length === 0}
          onClick={() => {
            setError(null);
            setSteps((s) => s.slice(0, -1));
          }}
        >
          Undo
        </button>
        <button
          type="button"
          className={`${missed ? 'btn-primary' : 'btn-secondary'} h-12`}
          disabled={steps.length === 0}
          onClick={() => {
            setError(null);
            setSteps([]);
          }}
        >
          Start over
        </button>
      </div>
      <p className="text-center text-sm text-muted">Unlimited tries. The clock keeps running until you solve it.</p>
    </div>
  );
}

function Solved({
  puzzle,
  local,
  solved,
  signedIn,
  token,
  onSignIn,
  onSubmitted,
  onSubmitError,
}: {
  puzzle: DailyPuzzleView;
  local: LocalPuzzle;
  solved: { timeMs: number; steps: CombineStep[] };
  signedIn: boolean;
  token: string | null;
  onSignIn: () => void;
  onSubmitted: (serverTimeMs: number | undefined) => void;
  onSubmitError: (message: string) => void;
}) {
  const [state, setState] = useState<StatsState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  // A sign-in problem or a definitive refusal; the curve still shows (estimate).
  const [submitNote, setSubmitNote] = useState<{ kind: 'auth' } | { kind: 'refused'; message: string } | null>(
    local.submitError ? { kind: 'refused', message: local.submitError } : null,
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setState({ kind: 'loading' });
    const statsPath = `/api/daily/stats?day=${encodeURIComponent(puzzle.day)}`;
    const showStats = (res: Awaited<ReturnType<typeof apiGet<DailyStatsView>>>) => {
      if (res.ok) setState({ kind: 'ready', stats: res.data });
      else if (res.status === 503) setState({ kind: 'unavailable' });
      else setState({ kind: 'error', message: res.error });
    };
    void (async () => {
      const shouldPost = signedIn && !local.submitted && !local.submitError;
      if (!shouldPost) {
        showStats(await apiGet<DailyStatsView>(statsPath, token));
        return;
      }
      const res = await apiPost<DailyStatsView>(
        '/api/daily/solve',
        { day: puzzle.day, steps: solved.steps, timeMs: solved.timeMs },
        token,
      );
      if (res.ok) {
        onSubmitted(res.data.mine?.timeMs);
        setState({ kind: 'ready', stats: res.data });
        return;
      }
      if (res.status === 401) {
        // Session expired: keep everything, ask to sign in again (retries next mount).
        setSubmitNote({ kind: 'auth' });
      } else if (res.status >= 400 && res.status < 500) {
        // Definitive refusal: remember it so we don't re-POST on every visit.
        onSubmitError(res.error);
        setSubmitNote({ kind: 'refused', message: res.error });
      } else if (res.status === 503) {
        setState({ kind: 'unavailable' });
        return;
      }
      // 5xx / network errors simply retry on the next mount.
      showStats(await apiGet<DailyStatsView>(statsPath, token));
    })();
  }, [signedIn, local.submitted, local.submitError, puzzle.day, solved, token, onSubmitted, onSubmitError]);

  const stats = state.kind === 'ready' ? state.stats : null;
  // The server's own number counts this solve; a guest gets an estimate.
  const mineTime = stats?.mine?.timeMs ?? solved.timeMs;
  const pct = stats ? (stats.mine?.fasterThanPct ?? approxFasterThan(stats, mineTime)) : null;
  const counted = Boolean(stats?.mine);

  async function copy() {
    try {
      await navigator.clipboard.writeText(puzzleShareText(puzzle, mineTime, pct));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="text-center">
        <p className="eyebrow">Solved · Make {puzzle.target}</p>
        <p className="font-display text-6xl font-extrabold tabular-nums">{formatDailyTime(mineTime)}</p>
      </div>

      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="curve-title">
        <h2 id="curve-title" className="font-display text-lg font-bold">Today’s solve times</h2>
        {state.kind === 'idle' || state.kind === 'loading' ? (
          <p className="text-sm text-muted" role="status">Loading the curve…</p>
        ) : state.kind === 'unavailable' ? (
          <p className="text-sm text-muted">The curve isn’t available right now. Your time is saved on this device.</p>
        ) : state.kind === 'error' ? (
          <p className="text-sm text-bad" role="alert">{state.message}</p>
        ) : stats && stats.solvers <= (counted ? 1 : 0) ? (
          <p className="text-sm">You’re the first to solve today’s puzzle.</p>
        ) : stats ? (
          <>
            <SolveCurve buckets={stats.buckets} timeMs={mineTime} />
            {pct !== null && (
              <p className="text-center text-lg">
                Faster than <strong>{pct}%</strong> of players
                {!counted && ' (estimate)'}
              </p>
            )}
            <p className="text-center text-sm text-muted">
              {stats.solvers.toLocaleString()} {stats.solvers === 1 ? 'player has' : 'players have'} solved
              today’s puzzle
            </p>
            {stats.medianMs !== null && (
              <p className="text-center text-sm text-muted">Median {formatDailyTime(stats.medianMs)}</p>
            )}
          </>
        ) : null}
      </section>

      {submitNote?.kind === 'auth' && (
        <div className="flex flex-col gap-2 text-center" role="alert">
          <p className="text-sm">Sign in again to be counted.</p>
          <button type="button" className="btn-secondary h-12" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}
      {submitNote?.kind === 'refused' && (
        <p className="text-center text-sm text-bad" role="alert">{submitNote.message}</p>
      )}

      {!signedIn && (
        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm text-muted">Sign in to be counted on the curve.</p>
          <button type="button" className="btn-secondary h-12" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}

      <button type="button" className="btn-primary h-12" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy result'}
      </button>
      <p className="sr-only" role="status">{copied ? 'Result copied to clipboard.' : ''}</p>
      <p className="text-center text-sm text-muted">New puzzle at midnight UTC.</p>
    </div>
  );
}

// ------------------------------------------------------------ chart

const W = 320;
const H = 140;
const PAD_X = 8;
const PLOT_TOP = 22;
const PLOT_BOTTOM = 112;

function SolveCurve({ buckets, timeMs }: { buckets: readonly SolveTimeBucket[]; timeMs: number }) {
  if (buckets.length === 0) return null;
  const n = buckets.length;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const xAt = (pos: number) => PAD_X + (pos / n) * (W - 2 * PAD_X);
  const yAt = (count: number) => PLOT_BOTTOM - (count / max) * (PLOT_BOTTOM - PLOT_TOP);

  const points = buckets.map((b, i) => [xAt(i + 0.5), yAt(b.count)] as const);
  const line = [
    `M ${xAt(0)} ${PLOT_BOTTOM}`,
    ...points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
    `L ${xAt(n)} ${PLOT_BOTTOM}`,
  ].join(' ');
  const area = `${line} Z`;

  const markerX = xAt(Math.min(n, Math.max(0, bucketPosition(buckets, timeMs))));
  const tickIdx = [0, Math.round(n / 3), Math.round((2 * n) / 3), n];
  const tickTime = (i: number) => (i >= n ? buckets[n - 1]!.toMs : buckets[i]!.fromMs);
  const labelAnchor = markerX < W * 0.2 ? 'start' : markerX > W * 0.8 ? 'end' : 'middle';

  const peak = buckets.reduce((a, b) => (b.count > a.count ? b : a));
  const summary =
    `Distribution of today’s solve times from ${shortTime(buckets[0]!.fromMs)} to ` +
    `${shortTime(buckets[n - 1]!.toMs)}. Most players solved between ${shortTime(peak.fromMs)} and ` +
    `${shortTime(peak.toMs)}. Your time, ${shortTime(timeMs)}, is marked.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
        <path d={area} className="fill-tile" />
        <path d={line} fill="none" className="stroke-ink" strokeWidth={2} strokeLinejoin="round" />
        <line x1={PAD_X} x2={W - PAD_X} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} className="stroke-line" strokeWidth={1} />
        <line x1={markerX} x2={markerX} y1={PLOT_TOP - 4} y2={PLOT_BOTTOM} stroke="#f2c94c" strokeWidth={4} />
        <line x1={markerX} x2={markerX} y1={PLOT_TOP - 4} y2={PLOT_BOTTOM} className="stroke-ink" strokeWidth={1} />
        <text x={markerX} y={PLOT_TOP - 8} textAnchor={labelAnchor} className="fill-ink" fontSize={11} fontWeight={700}>
          You · {shortTime(timeMs)}
        </text>
        {tickIdx.map((i, k) => (
          <text
            key={k}
            x={xAt(i)}
            y={PLOT_BOTTOM + 16}
            textAnchor={k === 0 ? 'start' : k === tickIdx.length - 1 ? 'end' : 'middle'}
            className="fill-muted"
            fontSize={11}
          >
            {shortTime(tickTime(i))}
          </text>
        ))}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
