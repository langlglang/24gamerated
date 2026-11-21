/**
 * Sliding-window counters for abuse limits (room-code guessing, challenge
 * spam). In memory, like rooms and the queue: one instance is the rule.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    this.sweeper = setInterval(() => this.sweep(), Math.max(windowMs, 10_000));
    this.sweeper.unref?.();
  }

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** True when `key` has used up its allowance (records nothing). */
  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.limit;
  }

  /** Record one use. Returns false if it went over the limit. */
  hit(key: string, now = Date.now()): boolean {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
    return list.length <= this.limit;
  }

  private sweep(): void {
    const now = Date.now();
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }
}
