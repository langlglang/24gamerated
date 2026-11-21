import { createHash, randomBytes } from 'node:crypto';
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
  readStringFields,
  validateEmail,
  validateLoginIdentifier,
  validatePassword,
  validateUsername,
  verifyPasswordConstantTime,
} from './credentials.js';
import { bearerFrom, issueToken, tokenMatchesPassword, verifyToken } from './tokens.js';
import { appUrl, sendMail } from './mailer.js';
import { consumePasswordReset, createPasswordReset } from '../db/resets.js';

/** How long a reset link works. Short, because it is as good as a password. */
const RESET_TTL_MS = 30 * 60_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function resetEmail(username: string, link: string) {
  const text = [
    `Hi ${username},`,
    '',
    'Someone asked to reset the password for your 24 account. If it was you, open this link within 30 minutes:',
    '',
    link,
    '',
    'If it wasn’t you, ignore this email. Your password stays the same.',
  ].join('\n');
  const html = `<p>Hi ${username},</p>
<p>Someone asked to reset the password for your 24 account. If it was you, open this link within 30 minutes:</p>
<p><a href="${link}">Reset your password</a></p>
<p>If it wasn’t you, ignore this email. Your password stays the same.</p>`;
  return { subject: 'Reset your 24 password', text, html };
}

/** Rated endpoints are unavailable rather than broken when there is no database. */
export function requireDatabase(_req: Request, res: Response, next: NextFunction): void {
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
  if (!tokenMatchesPassword(claims, user.password_hash)) {
    res.status(401).json({ error: 'Your password was changed. Sign in again.' });
    return;
  }
  req.user = user;
  next();
}

/**
 * Crude in-memory login throttle. Not a substitute for a real rate limiter,
 * but enough to make online password guessing impractical on a single box.
 */
const attempts = new Map<string, { count: number; firstAt: number; windowMs: number }>();
const ATTEMPT_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

function throttled(key: string, max = MAX_ATTEMPTS, windowMs = ATTEMPT_WINDOW_MS): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > windowMs) {
    attempts.set(key, { count: 1, firstAt: now, windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

/** Drop finished windows so the map cannot grow without bound. */
const throttleSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.firstAt > entry.windowMs) attempts.delete(key);
  }
}, 60_000);
throttleSweep.unref?.();

function clearThrottle(key: string): void {
  attempts.delete(key);
}

/** Password-reset requests: per sender IP, and per target address. */
const FORGOT_WINDOW_MS = 60 * 60_000;
const FORGOT_PER_IP = 10;
const FORGOT_PER_EMAIL = 5;

/**
 * Read the named string fields from the JSON body, or answer 400 and return
 * null when one of them is a number, array, object, etc.
 */
function stringFields<K extends string>(
  req: Request,
  res: Response,
  keys: readonly K[],
): Record<K, string> | null {
  const parsed = readStringFields(req.body, keys);
  if (!parsed.ok) {
    res.status(400).json({ error: 'That request was not formatted correctly.', field: parsed.field });
    return null;
  }
  return parsed.values;
}

export function createAuthRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  router.post('/auth/register', requireDatabase, async (req, res) => {
    const fields = stringFields(req, res, ['email', 'username', 'password'] as const);
    if (!fields) return;
    const email = fields.email.trim();
    const username = fields.username.trim();
    const password = fields.password;

    const issue = validateEmail(email) ?? validateUsername(username) ?? validatePassword(password);
    if (issue) {
      res.status(400).json({ error: issue.message, field: issue.field });
      return;
    }

    try {
      const user = await createUser(email, username, await hashPassword(password));
      res.status(201).json({ token: issueToken(user), user: toPublicUser(user) });
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
    const fields = stringFields(req, res, ['identifier', 'password'] as const);
    if (!fields) return;
    const identifier = fields.identifier.trim();
    const password = fields.password;

    if (!identifier || !password) {
      res.status(400).json({ error: 'Enter your email or username and password.' });
      return;
    }
    // Before the throttle and the lookup: a NUL byte would make Postgres throw.
    const identifierIssue = validateLoginIdentifier(identifier);
    if (identifierIssue) {
      res.status(400).json({ error: identifierIssue });
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
      // An unknown account still pays for one bcrypt comparison (against a
      // dummy hash), so response time does not give it away either.
      const ok = await verifyPasswordConstantTime(password, user?.password_hash);
      if (!user || !ok) {
        res.status(401).json({ error: 'Wrong email/username or password.' });
        return;
      }

      clearThrottle(key);
      await touchLastSeen(user.id);
      res.json({ token: issueToken(user), user: toPublicUser(user) });
    } catch (err) {
      console.error('[auth] login failed:', err);
      res.status(503).json({ error: 'Accounts are temporarily unavailable. Try again shortly.' });
    }
  });

  // Always answers the same way whether or not the email has an account, so
  // this cannot be used to find out who is registered.
  router.post('/auth/forgot', requireDatabase, async (req, res) => {
    const fields = stringFields(req, res, ['email'] as const);
    if (!fields) return;
    const email = fields.email.trim();
    const issue = validateEmail(email);
    if (issue) {
      res.status(400).json({ error: issue.message, field: 'email' });
      return;
    }
    // Per sender first (needs 'trust proxy' so req.ip is the player, not
    // Render's proxy). Only a request that passes it counts against the
    // address, so a sender who is already blocked cannot burn someone else's
    // quota. The per-address cap stops any inbox being flooded. A distributed
    // sender can still use up an address's quota for the hour, but every
    // request it makes mails a working link to the real owner, and the newest
    // one stays valid for 30 minutes, so that is a nuisance rather than a
    // takeover. 5 an hour leaves the owner some retries without letting anyone
    // send more than a handful of emails.
    const tooMany = () =>
      res.status(429).json({ error: 'Too many requests. Wait a while and try again.' });
    if (throttled(`forgot-ip:${req.ip ?? 'unknown'}`, FORGOT_PER_IP, FORGOT_WINDOW_MS)) {
      tooMany();
      return;
    }
    if (throttled(`forgot-email:${email.toLowerCase()}`, FORGOT_PER_EMAIL, FORGOT_WINDOW_MS)) {
      tooMany();
      return;
    }

    // Answer before touching the database or the mail API, so the response
    // time cannot reveal whether the address has an account.
    res.json({ ok: true });

    void (async () => {
      const user = await findByEmail(email);
      if (!user) return;
      const base = appUrl();
      if (!base) {
        console.error('[auth] APP_URL is not set — cannot build a password reset link');
        return;
      }
      const token = randomBytes(32).toString('base64url');
      await createPasswordReset(user.id, sha256(token), new Date(Date.now() + RESET_TTL_MS));
      await sendMail({ to: user.email, ...resetEmail(user.username, `${base}/?reset=${token}`) });
    })().catch((err) => console.error('[auth] password reset request failed:', err));
  });

  router.post('/auth/reset', requireDatabase, async (req, res) => {
    const fields = stringFields(req, res, ['token', 'password'] as const);
    if (!fields) return;
    const { token, password } = fields;
    if (!token) {
      res.status(400).json({ error: 'This reset link is incomplete. Request a new one.' });
      return;
    }
    const issue = validatePassword(password);
    if (issue) {
      res.status(400).json({ error: issue.message, field: 'password' });
      return;
    }
    try {
      const user = await consumePasswordReset(sha256(token), await hashPassword(password));
      if (!user) {
        // 410 lets the client offer a fresh link only for a dead token.
        res.status(410).json({
          error: 'This reset link has expired or was already used. Request a new one.',
        });
        return;
      }
      await touchLastSeen(user.id);
      res.json({
        token: issueToken(user),
        user: toPublicUser(user),
      });
    } catch (err) {
      console.error('[auth] password reset failed:', err);
      res.status(503).json({ error: 'Could not reset your password right now. Try again shortly.' });
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
