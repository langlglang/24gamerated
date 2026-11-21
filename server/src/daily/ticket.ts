import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isDailyKey } from '@24game/shared';

/**
 * Daily start tickets: server-signed proof of when a copy of a day's puzzle
 * was handed out. Every GET /api/daily/puzzle (guest or signed in) returns one;
 * the client keeps the first it got for the day and sends it back with the
 * solve, and the server times the solve from its issue time. So a guest who
 * solves and then signs in, or signs in halfway through, keeps the true start,
 * and nobody can claim a time shorter than what the server measured.
 *
 * Format: `v1.<day>.<issuedAtMs>.<base64url HMAC-SHA256>`. The key is derived
 * from JWT_SECRET (domain-separated, so a ticket is never a valid JWT signature
 * or vice versa). A ticket only ever makes a time longer than the holder's own
 * start (it can only be issued earlier, never later), so sharing one is not an
 * advantage; forging one needs the secret.
 */

const VERSION = 'v1';
const RECEIPT_VERSION = 'r1';
const DAY_MS = 86_400_000;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = (process.env.JWT_SECRET ?? '').trim();
  let base: string;
  if (configured.length >= 16) base = configured;
  else if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (16+ characters) in production');
  } else {
    // Dev only, same as the session tokens: tickets reset on restart.
    base = randomBytes(32).toString('hex');
  }
  cachedKey = createHash('sha256').update(`24game:daily-start-ticket:${base}`).digest();
  return cachedKey;
}

/** Tests only: forget the derived key so a changed JWT_SECRET takes effect. */
export function resetTicketKeyForTests(): void {
  cachedKey = null;
}

function mac(day: string, issuedAt: number): Buffer {
  return createHmac('sha256', key()).update(`${VERSION}:${day}:${issuedAt}`).digest();
}

function receiptMac(day: string, startedAt: number, solvedAt: number): Buffer {
  return createHmac('sha256', key()).update(`${RECEIPT_VERSION}:${day}:${startedAt}:${solvedAt}`).digest();
}

function sameMac(given: string, expected: Buffer): boolean {
  const buf = Buffer.from(given, 'base64url');
  // Length check first (timingSafeEqual needs it), then reject non-canonical encodings.
  return buf.length === expected.length && timingSafeEqual(buf, expected) && buf.toString('base64url') === given;
}

/** A ms timestamp inside the UTC day `day`. */
function inDay(day: string, at: number): boolean {
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  return at >= dayStart && at < dayStart + DAY_MS;
}

export function signStartTicket(day: string, issuedAt: number = Date.now()): string {
  if (!isDailyKey(day)) throw new RangeError(`not a daily key: ${day}`);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw new RangeError('bad issue time');
  return `${VERSION}.${day}.${issuedAt}.${mac(day, issuedAt).toString('base64url')}`;
}

/**
 * The ticket's issue time (ms since epoch) if it is genuine, for `day`, and
 * was issued during that UTC day and not in the future; null otherwise.
 * Never throws on junk input.
 */
export function verifyStartTicket(ticket: unknown, day: string, now: number = Date.now()): number | null {
  if (typeof ticket !== 'string' || ticket.length > 200) return null;
  const parts = ticket.split('.');
  if (parts.length !== 4) return null;
  const [version, tDay, tIssued, tMac] = parts as [string, string, string, string];
  if (version !== VERSION || tDay !== day || !isDailyKey(tDay)) return null;
  if (!/^\d{1,15}$/.test(tIssued)) return null;
  const issuedAt = Number(tIssued);
  // Only the server's GET for that day issues tickets, so the issue time lies
  // inside the day, and never after the moment we check it.
  if (!inDay(day, issuedAt) || issuedAt > now) return null;
  return sameMac(tMac, mac(tDay, issuedAt)) ? issuedAt : null;
}

/**
 * Solve receipts: issued by POST /daily/guest-solve once a guest's solution
 * checks out, they pin both ends of the solve (the start ticket's issue time
 * and the moment the server saw the solution). Format:
 * `r1.<day>.<startedAtMs>.<solvedAtMs>.<base64url HMAC>`.
 */
export function signSolveReceipt(day: string, startedAt: number, solvedAt: number): string {
  if (!isDailyKey(day)) throw new RangeError(`not a daily key: ${day}`);
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(solvedAt) || startedAt < 0 || solvedAt < startedAt) {
    throw new RangeError('bad receipt times');
  }
  return `${RECEIPT_VERSION}.${day}.${startedAt}.${solvedAt}.${receiptMac(day, startedAt, solvedAt).toString('base64url')}`;
}

/** Both times if the receipt is genuine and for `day`; null otherwise. Never throws on junk input. */
export function verifySolveReceipt(
  receipt: unknown,
  day: string,
  now: number = Date.now(),
): { startedAt: number; solvedAt: number } | null {
  if (typeof receipt !== 'string' || receipt.length > 200) return null;
  const parts = receipt.split('.');
  if (parts.length !== 5) return null;
  const [version, rDay, rStart, rSolved, rMac] = parts as [string, string, string, string, string];
  if (version !== RECEIPT_VERSION || rDay !== day || !isDailyKey(rDay)) return null;
  if (!/^\d{1,15}$/.test(rStart) || !/^\d{1,15}$/.test(rSolved)) return null;
  const startedAt = Number(rStart);
  const solvedAt = Number(rSolved);
  if (!inDay(day, startedAt) || solvedAt < startedAt || solvedAt > now) return null;
  return sameMac(rMac, receiptMac(rDay, startedAt, solvedAt)) ? { startedAt, solvedAt } : null;
}
