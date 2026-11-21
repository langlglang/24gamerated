import { afterEach, describe, expect, it } from 'vitest';
import { Matchmaker } from './matchmaking.js';
import { SlidingWindowLimiter } from './throttle.js';

describe('queue ownership', () => {
  const mm = new Matchmaker(
    () => {},
    () => {},
  );
  afterEach(() => mm.dispose());

  it('only the socket that queued can drop the entry implicitly', () => {
    mm.join({ userId: 'u1', username: 'u1', rating: 1200, socketId: 'tab-a' });
    expect(mm.leaveIfOwner('u1', 'tab-b')).toBe(false);
    expect(mm.has('u1')).toBe(true);
    expect(mm.leaveIfOwner('u1', 'tab-a')).toBe(true);
    expect(mm.has('u1')).toBe(false);
  });
});

describe('sliding window limiter', () => {
  it('allows `limit` hits per window, then blocks until the window passes', () => {
    const l = new SlidingWindowLimiter(3, 1000);
    expect([l.hit('k', 0), l.hit('k', 10), l.hit('k', 20)]).toEqual([true, true, true]);
    expect(l.blocked('k', 30)).toBe(true);
    expect(l.hit('k', 30)).toBe(false);
    expect(l.blocked('other', 30)).toBe(false);
    expect(l.blocked('k', 1031)).toBe(false);
  });
});
