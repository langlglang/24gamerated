import express from 'express';
import {
  MAX_SOLVE_MS,
  MIN_SOLVE_MS,
  OPS,
  bucketSolveTimes,
  checkPuzzleSolution,
  dailyKey,
  dailyNumber,
  dailyPuzzle,
  fasterThanPct,
  isDailyKey,
  previousDailyKey,
  type CombineStep,
  type DailyGuestSolveResponse,
  type DailyPuzzleView,
  type DailySolveErrorCode,
  type DailyStatsView,
} from '@24game/shared';
import { requireAuth, requireDatabase, type AuthedRequest } from '../auth/routes.js';
import { bearerFrom, tokenMatchesPassword, verifyToken } from '../auth/tokens.js';
import { dailyElapsedMs, dailySolveTimes, getDailySolve, recordDailyStart, saveDailySolve } from '../db/daily.js';
import { isDatabaseConfigured } from '../db/pool.js';
import { findById, isTestEmail } from '../db/users.js';
import { signSolveReceipt, signStartTicket, verifySolveReceipt, verifyStartTicket } from './ticket.js';

const MAX_STEPS = 5;

function isOpenDay(day: unknown): day is string {
  const today = dailyKey();
  // Yesterday too, so a solve started before midnight UTC still counts.
  return isDailyKey(day) && (day === today || day === previousDailyKey(today));
}

function refuse(res: express.Response, code: DailySolveErrorCode, error: string): void {
  res.status(400).json({ error, code });
}

function parseSteps(value: unknown): CombineStep[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) return null;
  const steps: CombineStep[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') return null;
    const s = v as Record<string, unknown>;
    const { aId, bId, op } = s;
    if (typeof aId !== 'string' || typeof bId !== 'string' || aId.length > 32 || bId.length > 32) return null;
    if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) return null;
    steps.push({ aId, bId, op } as CombineStep);
  }
  return steps;
}

const NO_START_MESSAGE =
  'We couldn’t confirm when you opened this puzzle, so this solve can’t be timed or counted. Tomorrow’s will be.';
const TOO_FAST_MESSAGE = 'That was too fast to count. Solves take at least 3 seconds.';

/** Shared checks for a posted solve: open day, readable steps, reaches the target. Sends the refusal itself. */
function readSolve(req: express.Request, res: express.Response): { day: string; steps: CombineStep[] } | null {
  const day: unknown = req.body?.day;
  if (!isOpenDay(day)) {
    refuse(res, 'closed', 'That puzzle is closed. Today’s is ready to play.');
    return null;
  }
  const steps = parseSteps(req.body?.steps);
  if (!steps) {
    refuse(res, 'bad-steps', 'That solution could not be read. Try solving it again.');
    return null;
  }
  if (!checkPuzzleSolution(dailyPuzzle(day), steps).ok) {
    refuse(res, 'not-target', 'That doesn’t reach the target yet. Keep trying.');
    return null;
  }
  return { day, steps };
}

/**
 * Everyone's solve times per day, cached briefly. The load test showed the
 * full query (every row, plus a scan for test accounts) turning a solve rush
 * into database timeouts; with the cache it runs at most once per few seconds
 * per day, however many players ask. A solve saved here is added straight
 * into the cached list, so the solver sees themselves counted immediately.
 */
const STATS_TTL_MS = 5_000;
const timesCache = new Map<string, { at: number; times: Promise<number[]>; loadedAt?: number }>();

function cachedSolveTimes(day: string): Promise<number[]> {
  const now = Date.now();
  const hit = timesCache.get(day);
  if (hit && now - hit.at < STATS_TTL_MS) return hit.times;
  // One query in flight per day; concurrent requests share it.
  const times = dailySolveTimes(day);
  const entry: { at: number; times: Promise<number[]>; loadedAt?: number } = { at: now, times };
  timesCache.set(day, entry);
  times.then(() => {
    entry.loadedAt = Date.now();
  }, () => {
    if (timesCache.get(day)?.times === times) timesCache.delete(day);
  });
  for (const key of timesCache.keys()) if (!isOpenDay(key)) timesCache.delete(key);
  return times;
}

/**
 * Put a just-saved solve into the cached list (kept sorted). Only when that
 * list finished loading before the save began, so it can't already hold the
 * solve; otherwise drop the entry and let the next request refetch.
 */
async function addToCachedTimes(day: string, timeMs: number, saveStartedAt: number): Promise<void> {
  const hit = timesCache.get(day);
  if (!hit) return;
  if (hit.loadedAt === undefined || hit.loadedAt >= saveStartedAt) {
    timesCache.delete(day);
    return;
  }
  try {
    const times = await hit.times;
    const at = times.findIndex((t) => t > timeMs);
    times.splice(at === -1 ? times.length : at, 0, timeMs);
  } catch {
    // The next request refetches.
  }
}

async function statsView(day: string, userId: string | null): Promise<DailyStatsView> {
  const [times, mine] = await Promise.all([
    cachedSolveTimes(day),
    userId ? getDailySolve(userId, day) : Promise.resolve(null),
  ]);
  const mineMs = mine ? mine.timeMs : null;
  const n = times.length;
  const medianMs =
    n === 0 ? null : n % 2 ? times[(n - 1) / 2]! : Math.round((times[n / 2 - 1]! + times[n / 2]!) / 2);
  // A test account's own time is not in `times`; add it so it is compared against everyone.
  const pool = mine && mine.isTestAccount ? [...times, mine.timeMs] : times;
  return {
    day,
    number: dailyNumber(day),
    solvers: n,
    medianMs,
    buckets: bucketSolveTimes(times),
    // fasterThanPct is null when the player is the only solver in the pool.
    mine: mineMs === null ? null : { timeMs: mineMs, fasterThanPct: fasterThanPct(mineMs, pool) },
  };
}

/** Signed-in user id if a valid, current token is present; null otherwise. Never rejects the request. */
async function optionalUserId(req: express.Request): Promise<string | null> {
  const claims = verifyToken(bearerFrom(req.headers.authorization));
  if (!claims) return null;
  const user = await findById(claims.userId);
  return user && tokenMatchesPassword(claims, user.password_hash) ? user.id : null;
}

/**
 * Generate today's and tomorrow's puzzles ahead of time (a few hundred ms of
 * search at worst) so no request pays for it, and again every 10 minutes so
 * the warm-up follows the UTC day roll. The timer never keeps the process alive.
 */
export function warmDailyPuzzles(): void {
  const warm = () => {
    try {
      const today = dailyKey();
      dailyPuzzle(today);
      dailyPuzzle(dailyKey(new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)));
    } catch (err) {
      console.error('[daily] warm-up failed:', err);
    }
  };
  warm();
  setInterval(warm, 10 * 60_000).unref();
}

/**
 * Daily puzzle: one puzzle per UTC day, solve time is the only measure.
 * Anyone can fetch the puzzle; saving a solve needs an account.
 */
export function createDailyRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  // No database needed: the puzzle is derived from the date.
  // Every fetch, guest or signed in, carries a signed start ticket (see
  // ticket.ts); a signed-in fetch also records when that account first opened
  // the puzzle. POST /daily/solve times the solve from the earlier of the two.
  router.get('/daily/puzzle', async (req, res) => {
    try {
      const now = Date.now();
      const day = dailyKey(new Date(now));
      const p = dailyPuzzle(day);
      const view: DailyPuzzleView = {
        day,
        number: dailyNumber(day),
        cards: p.cards,
        target: p.target,
        startTicket: signStartTicket(day, now),
      };
      // Never cached: each response carries its own start ticket, and a cached
      // copy could outlive midnight UTC and hand out yesterday's puzzle.
      res.set('Cache-Control', 'private, no-store');
      res.set('Vary', 'Authorization');
      if (req.headers.authorization && isDatabaseConfigured()) {
        try {
          const userId = await optionalUserId(req);
          if (userId) await recordDailyStart(userId, day);
        } catch (err) {
          console.error('[daily] recording start failed:', err);
        }
      }
      res.json(view);
    } catch (err) {
      console.error('[daily] puzzle failed:', err);
      res.status(500).json({ error: 'Could not load today’s puzzle. Try again in a moment.' });
    }
  });

  // A guest's solve: checked and stamped, not stored (no account). The receipt
  // pins when it happened, so posting it after signing in doesn't count the
  // time spent signing in. Needs a valid start ticket, like any timed solve.
  router.post('/daily/guest-solve', (req, res) => {
    try {
      const solve = readSolve(req, res);
      if (!solve) return;
      const now = Date.now();
      const startedAt = verifyStartTicket(req.body?.startTicket, solve.day, now);
      if (startedAt === null) {
        refuse(res, 'no-start', NO_START_MESSAGE);
        return;
      }
      const timeMs = Math.min(now - startedAt, MAX_SOLVE_MS);
      if (timeMs < MIN_SOLVE_MS) {
        refuse(res, 'too-fast', TOO_FAST_MESSAGE);
        return;
      }
      const body: DailyGuestSolveResponse = { timeMs, solveReceipt: signSolveReceipt(solve.day, startedAt, now) };
      res.set('Cache-Control', 'private, no-store');
      res.json(body);
    } catch (err) {
      console.error('[daily] guest solve failed:', err);
      res.status(500).json({ error: 'Could not check your solve. Try again in a moment.' });
    }
  });

  router.post('/daily/solve', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    // The client's claimed `timeMs` is not used for anything: the stored time
    // is always measured by the server (below), so it is not validated either.
    try {
      const solve = readSolve(req, res);
      if (!solve) return;
      const { day, steps } = solve;
      const userId = req.user!.id;
      // First solve stands; a repeat just returns the current stats.
      if (await getDailySolve(userId, day)) {
        res.json(await statsView(day, userId));
        return;
      }
      // Time rule (all server clocks, the client's claim is ignored):
      //   start = the earliest of: when this account first fetched the puzzle
      //           signed in (daily_starts), a valid start ticket's issue time,
      //           and a valid solve receipt's start;
      //   end   = a valid solve receipt's finish (the guest solved, then signed
      //           in), otherwise now.
      // With no start at all the solve can't be timed: refused, not stored, so
      // it never reaches the curve.
      const accountElapsed = await dailyElapsedMs(userId, day);
      const now = Date.now();
      const receipt = verifySolveReceipt(req.body?.solveReceipt, day, now);
      const starts = [
        accountElapsed === null ? null : now - accountElapsed,
        verifyStartTicket(req.body?.startTicket, day, now),
        receipt?.startedAt ?? null,
      ].filter((t): t is number => t !== null);
      if (starts.length === 0) {
        refuse(res, 'no-start', NO_START_MESSAGE);
        return;
      }
      const elapsed = (receipt ? receipt.solvedAt : now) - Math.min(...starts);
      // Validate the time actually used: at least MIN_SOLVE_MS; anything past a
      // day (only possible on yesterday's puzzle) is recorded as the maximum.
      const storedMs = Math.min(Math.round(elapsed), MAX_SOLVE_MS);
      if (storedMs < MIN_SOLVE_MS) {
        refuse(res, 'too-fast', TOO_FAST_MESSAGE);
        return;
      }
      const saveStartedAt = Date.now();
      const saved = await saveDailySolve(userId, day, storedMs, steps);
      // Test accounts are left out of the curve, so they aren't added to it either.
      if (saved && !isTestEmail(req.user!.email)) await addToCachedTimes(day, storedMs, saveStartedAt);
      res.json(await statsView(day, userId));
    } catch (err) {
      console.error('[daily] solve failed:', err);
      res.status(500).json({ error: 'Could not save your solve. Try again in a moment.' });
    }
  });

  router.get('/daily/stats', requireDatabase, async (req, res) => {
    const raw = req.query['day'];
    const day = raw === undefined ? dailyKey() : raw;
    if (!isOpenDay(day)) {
      res.status(400).json({ error: 'Stats are only kept for today and yesterday.' });
      return;
    }
    try {
      let userId: string | null = null;
      try {
        userId = await optionalUserId(req);
      } catch (err) {
        console.error('[daily] optional auth failed:', err);
      }
      res.json(await statsView(day, userId));
    } catch (err) {
      console.error('[daily] stats failed:', err);
      res.status(500).json({ error: 'Could not load the stats. Try again in a moment.' });
    }
  });

  return router;
}
