import express, { type Request, type Response, type NextFunction } from 'express';
import { isDatabaseConfigured } from '../db/pool.js';
import {
  DuplicateUserError,
  createUser,
  findByEmail,
  findById,
  findByUsername,
  leaderboard,
  toPublicUser,
  touchLastSeen,
  type UserRow,
} from '../db/users.js';
import { matchHistory } from '../db/matches.js';
import {
  hashPassword,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './credentials.js';
import { bearerFrom, issueToken, verifyToken } from './tokens.js';

/** Rated endpoints are unavailable rather than broken when there is no database. */
function requireDatabase(_req: Request, res: Response, next: NextFunction): void {
  if (!isDatabaseConfigured()) {
    res.status(503).json({
      error: 'Accounts are not configured on this server. Guest play is still available.',
    });
    return;
  }
  next();
}

export interface AuthedRequest extends Request {
  user?: UserRow;
}

/** Attaches req.user when a valid token is present; 401s when it is not. */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const claims = verifyToken(bearerFrom(req.headers.authorization));
  if (!claims) {
    res.status(401).json({ error: 'Sign in to do that.' });
    return;
  }
  // Express 4 does not catch rejected promises, so a database error here
  // would otherwise be an unhandled rejection that kills the process.
  let user: UserRow | null;
  try {
    user = await findById(claims.userId);
  } catch (err) {
    console.error('[auth] account lookup failed:', err);
    res.status(503).json({ error: 'Accounts are temporarily unavailable. Try again shortly.' });
    return;
  }
  if (!user) {
    res.status(401).json({ error: 'That account no longer exists.' });
    return;
  }
  req.user = user;
  next();
}

/**
 * Crude in-memory login throttle. Not a substitute for a real rate limiter,
 * but enough to make online password guessing impractical on a single box.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const ATTEMPT_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

function throttled(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearThrottle(key: string): void {
  attempts.delete(key);
}

export function createAuthRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  router.post('/auth/register', requireDatabase, async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');

    const issue = validateEmail(email) ?? validateUsername(username) ?? validatePassword(password);
    if (issue) {
      res.status(400).json({ error: issue.message, field: issue.field });
      return;
    }

    try {
      const user = await createUser(email, username, await hashPassword(password));
      res.status(201).json({ token: issueToken({ userId: user.id, username: user.username }), user: toPublicUser(user) });
    } catch (err) {
      if (err instanceof DuplicateUserError) {
        res.status(409).json({
          error:
            err.field === 'username'
              ? 'That username is taken.'
              : 'An account with that email already exists.',
          field: err.field,
        });
        return;
      }
      console.error('[auth] register failed:', err);
      res.status(500).json({ error: 'Could not create the account.' });
    }
  });

  router.post('/auth/login', requireDatabase, async (req, res) => {
    const identifier = String(req.body?.identifier ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!identifier || !password) {
      res.status(400).json({ error: 'Enter your email or username and password.' });
      return;
    }

    const key = `${req.ip ?? 'unknown'}:${identifier.toLowerCase()}`;
    if (throttled(key)) {
      res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
      return;
    }

    try {
      // Accept either an email or a username in the same box.
      const user = identifier.includes('@')
        ? await findByEmail(identifier)
        : await findByUsername(identifier);

      // Same message either way, so this cannot be used to enumerate accounts.
      const ok = user ? await verifyPassword(password, user.password_hash) : false;
      if (!user || !ok) {
        res.status(401).json({ error: 'Wrong email/username or password.' });
        return;
      }

      clearThrottle(key);
      await touchLastSeen(user.id);
      res.json({ token: issueToken({ userId: user.id, username: user.username }), user: toPublicUser(user) });
    } catch (err) {
      console.error('[auth] login failed:', err);
      res.status(503).json({ error: 'Accounts are temporarily unavailable. Try again shortly.' });
    }
  });

  router.get('/auth/me', requireDatabase, requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: toPublicUser(req.user!) });
  });

  router.get('/leaderboard', requireDatabase, async (_req, res) => {
    try {
      res.json({ entries: await leaderboard(25) });
    } catch (err) {
      console.error('[api] leaderboard failed:', err);
      res.status(500).json({ error: 'Could not load the leaderboard.' });
    }
  });

  router.get('/me/matches', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    try {
      res.json({ matches: await matchHistory(req.user!.id, 10) });
    } catch (err) {
      console.error('[api] match history failed:', err);
      res.status(500).json({ error: 'Could not load your matches.' });
    }
  });

  return router;
}
