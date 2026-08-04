import type { QueueStatusView } from '@24game/shared';

export interface QueueEntry {
  userId: string;
  username: string;
  rating: number;
  socketId: string;
  joinedAt: number;
}

/** Starting rating window, in points, either side of a searching player. */
const INITIAL_BAND = 100;
/** How much the window grows per step of waiting. */
const BAND_STEP = 50;
const BAND_STEP_MS = 5_000;
/** Past this, effectively anyone will do. */
const MAX_BAND = 1_200;

const TICK_MS = 1_000;

export function bandFor(waitedMs: number): number {
  const steps = Math.floor(Math.max(waitedMs, 0) / BAND_STEP_MS);
  return Math.min(INITIAL_BAND + steps * BAND_STEP, MAX_BAND);
}

/**
 * Rating-banded matchmaking queue, held in memory.
 *
 * Both players must find the other acceptable — the gap has to fit inside the
 * narrower of the two windows — so a player who just joined is never dragged
 * into a lopsided game just because someone else has been waiting a long time.
 * Windows widen with waiting, so a quiet queue still matches eventually.
 */
export class Matchmaker {
  private queue = new Map<string, QueueEntry>();
  private ticker: NodeJS.Timeout;

  constructor(
    private readonly onPair: (a: QueueEntry, b: QueueEntry) => void,
    private readonly onStatus: (entry: QueueEntry, status: QueueStatusView) => void,
  ) {
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.ticker.unref?.();
  }

  join(entry: Omit<QueueEntry, 'joinedAt'>): boolean {
    if (this.queue.has(entry.userId)) return false;
    this.queue.set(entry.userId, { ...entry, joinedAt: Date.now() });
    // Try immediately so two players arriving together do not wait a tick.
    this.tick();
    return true;
  }

  leave(userId: string): void {
    this.queue.delete(userId);
  }

  has(userId: string): boolean {
    return this.queue.has(userId);
  }

  /** Keep a queued player's socket current across a reconnect. */
  updateSocket(userId: string, socketId: string): void {
    const entry = this.queue.get(userId);
    if (entry) entry.socketId = socketId;
  }

  get size(): number {
    return this.queue.size;
  }

  statusFor(userId: string): QueueStatusView {
    const entry = this.queue.get(userId);
    if (!entry) return { inQueue: false, waitingMs: 0, searching: this.queue.size, band: 0 };
    const waitingMs = Date.now() - entry.joinedAt;
    return {
      inQueue: true,
      waitingMs,
      searching: this.queue.size,
      band: bandFor(waitingMs),
    };
  }

  private tick(): void {
    const now = Date.now();
    // Sorting by rating means the closest candidate is always adjacent.
    const waiting = [...this.queue.values()].sort((a, b) => a.rating - b.rating);
    const paired = new Set<string>();

    for (let i = 0; i < waiting.length - 1; i++) {
      const a = waiting[i]!;
      if (paired.has(a.userId)) continue;

      for (let j = i + 1; j < waiting.length; j++) {
        const b = waiting[j]!;
        if (paired.has(b.userId)) continue;

        const gap = Math.abs(a.rating - b.rating);
        const mutual = Math.min(bandFor(now - a.joinedAt), bandFor(now - b.joinedAt));
        if (gap > mutual) break; // sorted, so everyone further along is worse

        paired.add(a.userId);
        paired.add(b.userId);
        this.queue.delete(a.userId);
        this.queue.delete(b.userId);
        this.onPair(a, b);
        break;
      }
    }

    // Anyone still searching gets a refreshed status line.
    for (const entry of this.queue.values()) {
      this.onStatus(entry, this.statusFor(entry.userId));
    }
  }

  dispose(): void {
    clearInterval(this.ticker);
    this.queue.clear();
  }
}
