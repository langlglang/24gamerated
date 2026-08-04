import bcrypt from 'bcryptjs';

/**
 * Cost 10 is ~50-80ms per hash on typical hardware: slow enough to make
 * offline cracking expensive, fast enough that login does not feel laggy.
 */
const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Letters, digits, underscore, hyphen. Keeps usernames typeable in a challenge box. */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Deliberately permissive — we are not the arbiter of what an address may look like. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidationIssue = { field: 'email' | 'username' | 'password'; message: string };

export function validateEmail(email: string): ValidationIssue | null {
  const value = email.trim();
  if (value.length === 0) return { field: 'email', message: 'Email is required.' };
  if (value.length > 200) return { field: 'email', message: 'That email is too long.' };
  if (!EMAIL_PATTERN.test(value))
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

export function validatePassword(password: string): ValidationIssue | null {
  if (password.length < PASSWORD_MIN)
    return { field: 'password', message: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX)
    return { field: 'password', message: 'That password is too long.' };
  return null;
}
