import pg from 'pg';

/**
 * Rated play needs a real database; guest play does not. When DATABASE_URL is
 * unset the whole rated surface switches off and the app still runs as the
 * original room-code game, so a missing database is a degraded mode rather
 * than a crash.
 */
export const isDatabaseConfigured = (): boolean => (process.env.DATABASE_URL ?? '').trim().length > 0;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  const url = (process.env.DATABASE_URL ?? '').trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set — rated features are unavailable');
  }
  if (!pool) {
    // Neon and most hosted Postgres require TLS. Their certificates are
    // publicly trusted, so verification stays on.
    const needsSsl = /sslmode=(require|verify-full)/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run several statements atomically. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** True when the database is reachable — surfaced by /healthz. */
export async function pingDatabase(): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
