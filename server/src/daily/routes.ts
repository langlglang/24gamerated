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
  type DailyPuzzleView,
  type DailyStatsView,
} from '@24game/shared';
import { requireAuth, requireDatabase, type AuthedRequest } from '../auth/routes.js';
import { bearerFrom, tokenMatchesPassword, verifyToken } from '../auth/tokens.js';
import { dailySolveTimes, getDailySolveTime, saveDailySolve } from '../db/daily.js';
import { findById } from '../db/users.js';

const MAX_STEPS = 5;

function isOpenDay(day: unknown): day is string {
  const today = dailyKey();
  // Yesterday too, so a solve started before midnight UTC still counts.
  return isDailyKey(day) && (day === today || day === previousDailyKey(today));
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

async function statsView(day: string, userId: string | null): Promise<DailyStatsView> {
  const [times, mineMs] = await Promise.all([
    dailySolveTimes(day),
    userId ? getDailySolveTime(userId, day) : Promise.resolve(null),
  ]);
  const n = times.length;
  const medianMs =
    n === 0 ? null : n % 2 ? times[(n - 1) / 2]! : Math.round((times[n / 2 - 1]! + times[n / 2]!) / 2);
  // A test account's own time is not in `times`; compare it against everyone anyway.
  const pool = mineMs !== null && !times.includes(mineMs) ? [...times, mineMs] : times;
  return {
    day,
    number: dailyNumber(day),
    solvers: n,
    medianMs,
    buckets: bucketSolveTimes(times),
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
 * Daily puzzle: one puzzle per UTC day, solve time is the only measure.
 * Anyone can fetch the puzzle; saving a solve needs an account.
 */
export function createDailyRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  // No database needed: the puzzle is derived from the date.
  router.get('/daily/puzzle', (_req, res) => {
    try {
      const day = dailyKey();
      const p = dailyPuzzle(day);
      const view: DailyPuzzleView = { day, number: dailyNumber(day), cards: p.cards, target: p.target };
      res.set('Cache-Control', 'public, max-age=300');
      res.json(view);
    } catch (err) {
      console.error('[daily] puzzle failed:', err);
      res.status(500).json({ error: 'Could not load today’s puzzle. Try again in a moment.' });
    }
  });

  router.post('/daily/solve', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    const day: unknown = req.body?.day;
    const timeMs: unknown = req.body?.timeMs;
    if (!isOpenDay(day)) {
      res.status(400).json({ error: 'That puzzle is closed. Today’s is ready to play.' });
      return;
    }
    const steps = parseSteps(req.body?.steps);
    if (!steps) {
      res.status(400).json({ error: 'That solution could not be read. Try solving it again.' });
      return;
    }
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs > MAX_SOLVE_MS) {
      res.status(400).json({ error: 'That solve time could not be read. Try solving it again.' });
      return;
    }
    if (timeMs < MIN_SOLVE_MS) {
      res.status(400).json({ error: 'That was too fast to count. Solves take at least 3 seconds.' });
      return;
    }
    try {
      if (!checkPuzzleSolution(dailyPuzzle(day), steps).ok) {
        res.status(400).json({ error: 'That doesn’t reach the target yet. Keep trying.' });
        return;
      }
      // First solve stands; a repeat just returns the current stats.
      await saveDailySolve(req.user!.id, day, Math.round(timeMs), steps);
      res.json(await statsView(day, req.user!.id));
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
