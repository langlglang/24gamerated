import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Sessions are stateless JWTs. The client keeps the token and presents it both
 * on REST calls (Authorization header) and on the socket handshake, so there
 * is one notion of "who you are" across both transports.
 *
 * Tradeoff worth knowing: a stateless token cannot be revoked before it
 * expires. For a game leaderboard that is an acceptable trade; anything
 * involving payments would want server-side sessions instead.
 */
const TOKEN_TTL = '30d';

let cachedSecret: string | null = null;

function secret(): string {
  if (cachedSecret) return cachedSecret;
  const configured = (process.env.JWT_SECRET ?? '').trim();
  if (configured.length >= 16) {
    cachedSecret = configured;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (16+ characters) in production');
  }
  // Dev convenience: a random secret means everyone is logged out on restart,
  // which is annoying but never insecure.
  cachedSecret = randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET not set — using a random dev secret; logins reset on restart');
  return cachedSecret;
}

export interface SessionClaims {
  userId: string;
  username: string;
  /**
   * Fingerprint of the password hash when the token was issued. Changing the
   * password changes it, which signs out every other session. Absent on
   * tokens issued before this existed; those are accepted until they expire.
   */
  pwv?: string;
}

/** Short, one-way fingerprint of a password hash. Never the hash itself. */
export function passwordVersion(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 12);
}

/** True unless the token predates a password change. */
export function tokenMatchesPassword(claims: SessionClaims, passwordHash: string): boolean {
  return claims.pwv === undefined || claims.pwv === passwordVersion(passwordHash);
}

export function issueToken(user: { id: string; username: string; password_hash: string }): string {
  const claims = { username: user.username, pwv: passwordVersion(user.password_hash) };
  return jwt.sign(claims, secret(), {
    subject: user.id,
    expiresIn: TOKEN_TTL,
  });
}

/** Returns null for anything invalid, expired, or malformed. Never throws. */
export function verifyToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === 'string' || !payload.sub) return null;
    const pwv = (payload as { pwv?: unknown }).pwv;
    return {
      userId: String(payload.sub),
      username: String((payload as { username?: unknown }).username ?? ''),
      ...(typeof pwv === 'string' ? { pwv } : {}),
    };
  } catch {
    return null;
  }
}

/** Pull a bearer token out of an Authorization header. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
