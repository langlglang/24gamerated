import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Load .env no matter where the process was started from.
 *
 * `dotenv/config` alone reads ./env relative to the working directory, which
 * breaks the moment something runs from a workspace folder (`npm run migrate
 * --workspace=server` has cwd=server/) rather than the repo root. Walking up
 * from both the cwd and this module's own location finds the one real .env in
 * either case.
 *
 * Import this before anything that reads process.env.
 */
function findEnvFile(): string | null {
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    // Deep enough to climb out of server/dist/db without running away.
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, '.env');
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const envFile = findEnvFile();
if (envFile) {
  dotenv.config({ path: envFile });
}

export const ENV_FILE = envFile;
