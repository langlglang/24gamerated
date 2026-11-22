import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

/**
 * Runs bcrypt off the main thread (see hashPool.ts). bcryptjs is pure JS, so
 * on the main thread every hash (~60 ms) would freeze all live games.
 */
type Job = { id: number; op: 'hash'; plain: string; rounds: number } | { id: number; op: 'compare'; plain: string; hash: string };

parentPort?.on('message', (job: Job) => {
  try {
    const result = job.op === 'hash' ? bcrypt.hashSync(job.plain, job.rounds) : bcrypt.compareSync(job.plain, job.hash);
    parentPort!.postMessage({ id: job.id, ok: true, result });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
