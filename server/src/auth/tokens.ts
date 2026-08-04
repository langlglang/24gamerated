import { randomBytes } from 'node:crypto';
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
}

export function issueToken(claims: SessionClaims): string {
  return jwt.sign({ username: claims.username }, secret(), {
    subject: claims.userId,
    expiresIn: TOKEN_TTL,
  });
}

/** Returns null for anything invalid, expired, or malformed. Never throws. */
export function verifyToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === 'string' || !payload.sub) return null;
    return {
      userId: String(payload.sub),
      username: String((payload as { username?: unknown }).username ?? ''),
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
