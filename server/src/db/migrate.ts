import { MIGRATIONS } from './migrations.js';
import { getPool, isDatabaseConfigured } from './pool.js';

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

/**
 * Apply any migrations this database has not seen. Each runs inside its own
 * transaction together with its ledger row, so a failure leaves no partial
 * migration recorded.
 *
 * Safe to call on every boot: already-applied migrations are skipped.
 */
export async function runMigrations(): Promise<MigrationReport> {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not set');
  }

  const pool = getPool();
  await pool.query(LEDGER);

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  const report: MigrationReport = { applied: [], skipped: [] };

  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) {
      report.skipped.push(migration.name);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
      report.applied.push(migration.name);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `migration ${migration.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }

  return report;
}
