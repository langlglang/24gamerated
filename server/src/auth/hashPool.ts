import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

/**
 * A small pool of worker threads for bcrypt. The load test showed each hash
 * blocking the event loop for ~60 ms, so ~15 sign-ins a second pushed every
 * live game's latency past 250 ms. In workers, sign-ins only cost CPU.
 *
 * When the compiled worker file is missing (running from TypeScript source in
 * tests or `tsx`), it falls back to bcryptjs on the main thread.
 */
const WORKER_FILE = fileURLToPath(new URL('./hashWorker.js', import.meta.url));
const SIZE = Math.max(1, Math.min(2, availableParallelism() - 1));
/** Jobs waiting beyond this are refused, so a flood can't queue forever. */
export const MAX_QUEUED = 200;

export class HashPoolBusyError extends Error {
  constructor() {
    super('password hashing queue is full');
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Slot = { worker: Worker; pending: Map<number, Pending> };

let slots: Slot[] | null = null;
let nextId = 1;
let inFlight = 0;

const useWorkers = existsSync(WORKER_FILE) && !WORKER_FILE.endsWith('.ts');

function spawn(): Slot {
  const slot: Slot = { worker: new Worker(WORKER_FILE), pending: new Map() };
  slot.worker.unref();
  slot.worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const p = slot.pending.get(msg.id);
    if (!p) return;
    slot.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });
  let dead = false;
  const fail = (err: Error) => {
    if (dead) return;
    dead = true;
    for (const p of slot.pending.values()) p.reject(err);
    slot.pending.clear();
    // Replace the dead worker so later jobs still have somewhere to go.
    const i = slots ? slots.indexOf(slot) : -1;
    if (slots && i >= 0) slots[i] = spawn();
  };
  slot.worker.on('error', fail);
  slot.worker.on('exit', (code) => {
    if (slot.pending.size > 0 || code !== 0) fail(new Error(`hash worker exited with code ${code}`));
  });
  return slot;
}

function run<T>(job: { op: 'hash'; plain: string; rounds: number } | { op: 'compare'; plain: string; hash: string }): Promise<T> {
  if (!useWorkers) {
    return (job.op === 'hash' ? bcrypt.hash(job.plain, job.rounds) : bcrypt.compare(job.plain, job.hash)) as Promise<T>;
  }
  if (inFlight >= MAX_QUEUED) return Promise.reject(new HashPoolBusyError());
  slots ??= Array.from({ length: SIZE }, spawn);
  // Least-busy worker.
  const slot = slots.reduce((a, b) => (b.pending.size < a.pending.size ? b : a));
  const id = nextId++;
  inFlight += 1;
  return new Promise<T>((resolve, reject) => {
    slot.pending.set(id, {
      resolve: (v) => {
        inFlight -= 1;
        resolve(v as T);
      },
      reject: (e) => {
        inFlight -= 1;
        reject(e);
      },
    });
    slot.worker.postMessage({ id, ...job });
  });
}

export const hashInPool = (plain: string, rounds: number) => run<string>({ op: 'hash', plain, rounds });
export const compareInPool = (plain: string, hash: string) => run<boolean>({ op: 'compare', plain, hash });

/** Stop the workers (graceful shutdown). */
export async function closeHashPool(): Promise<void> {
  const current = slots;
  slots = null;
  if (current) await Promise.all(current.map((s) => s.worker.terminate()));
}
