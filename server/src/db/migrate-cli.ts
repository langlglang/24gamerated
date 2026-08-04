import 'dotenv/config';
import { runMigrations } from './migrate.js';
import { closePool, isDatabaseConfigured } from './pool.js';

/** `npm run migrate` — applies pending migrations, then exits. */
async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL is not set. Put it in .env or the environment first.');
    process.exit(1);
  }

  const report = await runMigrations();
  if (report.applied.length === 0) {
    console.log(`Nothing to do — ${report.skipped.length} migration(s) already applied.`);
  } else {
    for (const name of report.applied) console.log(`applied ${name}`);
    console.log(`\n${report.applied.length} migration(s) applied.`);
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closePool().catch(() => {});
  process.exit(1);
});
