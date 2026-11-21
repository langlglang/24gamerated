import bcrypt from 'bcryptjs';

/**
 * Cost 10 is ~50-80ms per hash on typical hardware: slow enough to make
 * offline cracking expensive, fast enough that login does not feel laggy.
 */
export const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A hash of a random throwaway password at the same cost as real ones. Login
 * compares against it when the account does not exist, so an unknown
 * username takes as long to reject as a wrong password and response time
 * cannot reveal who is registered. Computed once at startup (~one hash).
 */
export const DUMMY_HASH = bcrypt.hashSync(
  `dummy-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  BCRYPT_ROUNDS,
);

/**
 * Check a password against the account's hash, or against DUMMY_HASH when
 * there is no account. Always does one full bcrypt comparison.
 */
export async function verifyPasswordConstantTime(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return hash ? ok : false;
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
/**
 * bcrypt only looks at the first 72 bytes of its input, so anything past that
 * would be silently ignored. The limit is in UTF-8 bytes, not characters:
 * 72 ASCII characters, fewer with accents or emoji. Enforced on register and
 * reset only; login accepts any length, so accounts created before this limit
 * keep working (bcrypt truncates the same way it did when they registered).
 */
export const PASSWORD_MAX_BYTES = 72;
export const EMAIL_MAX = 200;
/** Long enough for any valid email or username; anything longer is junk. */
export const IDENTIFIER_MAX = EMAIL_MAX;

/** Letters, digits, underscore, hyphen. Keeps usernames typeable in a challenge box. */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Deliberately permissive — we are not the arbiter of what an address may look like. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** C0 controls (including NUL, which Postgres rejects in text) and DEL..C1. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export const hasControlChars = (value: string): boolean => CONTROL_CHARS.test(value);

export type ValidationIssue = { field: 'email' | 'username' | 'password'; message: string };

/**
 * Pull string fields out of a parsed JSON body. A missing or null field reads
 * as '' (so the usual "X is required" messages still apply); any other
 * non-string value (number, array, object, boolean) is rejected, rather than
 * being coerced through String() into something like "a,b" or
 * "[object Object]". Returns the offending field name on failure.
 */
export function readStringFields<K extends string>(
  body: unknown,
  keys: readonly K[],
): { ok: true; values: Record<K, string> } | { ok: false; field: K } {
  const source = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const values = {} as Record<K, string>;
  for (const key of keys) {
    const raw = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
    if (raw === undefined || raw === null) values[key] = '';
    else if (typeof raw === 'string') values[key] = raw;
    else return { ok: false, field: key };
  }
  return { ok: true, values };
}

export function validateEmail(email: string): ValidationIssue | null {
  const value = email.trim();
  if (value.length === 0) return { field: 'email', message: 'Email is required.' };
  if (value.length > EMAIL_MAX) return { field: 'email', message: 'That email is too long.' };
  if (hasControlChars(value) || !EMAIL_PATTERN.test(value))
    return { field: 'email', message: 'That does not look like an email address.' };
  return null;
}

export function validateUsername(username: string): ValidationIssue | null {
  const value = username.trim();
  if (value.length < USERNAME_MIN)
    return { field: 'username', message: `Username must be at least ${USERNAME_MIN} characters.` };
  if (value.length > USERNAME_MAX)
    return { field: 'username', message: `Username must be at most ${USERNAME_MAX} characters.` };
  if (!USERNAME_PATTERN.test(value))
    return {
      field: 'username',
      message: 'Usernames may use letters, numbers, underscore and hyphen only.',
    };
  return null;
}

/** For new passwords (register, reset). Login does not apply these rules. */
export function validatePassword(password: string): ValidationIssue | null {
  if (password.length < PASSWORD_MIN)
    return { field: 'password', message: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES)
    return {
      field: 'password',
      message:
        'That password is too long. Use at most 72 characters (fewer if it has accents or emoji).',
    };
  return null;
}

/**
 * The login box takes an email or a username. Rejects junk before it reaches
 * the database: empty, absurdly long, or containing control characters (a NUL
 * would make Postgres throw). Returns an error message, or null when usable.
 */
export function validateLoginIdentifier(identifier: string): string | null {
  const value = identifier.trim();
  if (value.length === 0) return 'Enter your email or username and password.';
  if (value.length > IDENTIFIER_MAX || hasControlChars(value))
    return 'Wrong email/username or password.';
  return null;
}
