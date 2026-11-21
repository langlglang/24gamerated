import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_TIMEOUT_MS,
  HAND_IDLE_TIMEOUT_MS,
  HAND_RESULT_DISPLAY_MS,
  RECONNECT_GRACE_MS,
  solveCards,
  type RuleSet,
} from '@24game/shared';
import { Room, type RoomEvents } from './room.js';

const RULES: RuleSet = { fractions: false, negatives: false };

function events(): RoomEvents & { closed: string[]; changes: number } {
  const e = {
    closed: [] as string[],
    changes: 0,
    onChange: () => {
      e.changes++;
    },
    onCombineRejected: () => {},
    onClosed: (_r: Room, reason: string) => {
      e.closed.push(reason);
    },
  };
  return e;
}

/** A started ffa room with the given seat ids; socket of seat X is `s-X`. */
function startedRoom(ids: string[], ev = events()): Room {
  const room = new Room('ABCDEF', { id: ids[0]!, name: ids[0]!, socketId: `s-${ids[0]}` }, 'ffa', RULES, ev);
  for (const id of ids.slice(1)) {
    const r = room.join({ id, name: id, socketId: `s-${id}` });
    expect(r.ok).toBe(true);
  }
  expect(room.start(ids[0]!).ok).toBe(true);
  return room;
}

/** Advance to the next open hand where the dealt cards are solvable. */
function seekSolvable(room: Room, by: string): ReturnType<typeof solveCards> {
  for (let i = 0; i < 20; i++) {
    const sol = solveCards(room.publicState().cards, room.rules);
    if (sol.solvable) return sol;
    room.callNoSolution(by);
    vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
  }
  throw new Error('no solvable hand found');
}

/** The given player wins the current open hand outright. */
function win(room: Room, id: string): void {
  const sol = solveCards(room.publicState().cards, room.rules);
  if (!sol.solvable) {
    expect(room.callNoSolution(id).ok).toBe(true);
    return;
  }
  expect(room.buzz(id).ok).toBe(true);
  for (const step of sol.steps!) room.combine(id, step);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('seat credentials', () => {
  it('issues a distinct reconnect token per seat and checks it exactly', () => {
    const room = new Room('ABCDEF', { id: 'a', name: 'A', socketId: 's-a' }, 'ffa', RULES, events());
    const joined = room.join({ id: 'b', name: 'B', socketId: 's-b' });
    if (!joined.ok) throw new Error('join failed');
    const tokenA = room.reconnectTokenFor('a')!;
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(joined.reconnectToken).not.toBe(tokenA);
    expect(room.checkReconnectToken('a', tokenA)).toBe(true);
    expect(room.checkReconnectToken('b', tokenA)).toBe(false);
    expect(room.checkReconnectToken('a', undefined)).toBe(false);
    expect(room.checkReconnectToken('a', tokenA.slice(1))).toBe(false);
    expect(room.checkReconnectToken('nobody', tokenA)).toBe(false);
    // Tokens never appear in what is broadcast.
    expect(JSON.stringify(room.publicState())).not.toContain(tokenA);
  });

  it('refuses a new seat with an id that is already seated', () => {
    const room = new Room('ABCDEF', { id: 'a', name: 'A', socketId: 's-a' }, 'ffa', RULES, events());
    expect(room.join({ id: 'a', name: 'Other', socketId: 's-x' }).ok).toBe(false);
    expect(room.players).toHaveLength(1);
  });

  it('reports the socket it replaces when a seat is reclaimed while connected', () => {
    const room = startedRoom(['a', 'b']);
    const r = room.reconnect('b', 's-b2');
    expect(r.ok && r.replacedSocketId).toBe('s-b');
    // The old socket no longer maps to the seat, so its disconnect is a no-op.
    room.disconnect('s-b');
    expect(room.phase).toBe('open');
  });

  it('stores only the two known rule toggles', () => {
    const junk = { fractions: true, negatives: false, junk: 'x'.repeat(1000) } as unknown as RuleSet;
    const room = new Room('ABCDEF', { id: 'a', name: 'A', socketId: 's-a' }, 'ffa', junk, events());
    expect(room.publicState().rules).toEqual({ fractions: true, negatives: false });
    room.configure('a', undefined, { ...junk, fractions: false });
    expect(Object.keys(room.publicState().rules).sort()).toEqual(['fractions', 'negatives']);
  });
});

describe('a __proto__ seat id still scores', () => {
  it('credits the point in the room scoreboard', () => {
    const room = startedRoom(['__proto__', 'b']);
    seekSolvable(room, 'b');
    const before = room.scores['__proto__'] ?? 0;
    win(room, '__proto__');
    expect(room.phase).toBe('hand-result');
    expect(Object.hasOwn(room.scores, '__proto__')).toBe(true);
    expect(room.scores['__proto__']).toBe(before + 1);
  });
});

describe('pause and resume', () => {
  it('keeps the answerer\'s attempt when someone else drops (bug: buzz erased)', () => {
    const room = startedRoom(['a', 'b', 'c']);
    const sol = seekSolvable(room, 'c');
    expect(room.buzz('b').ok).toBe(true);
    room.combine('b', sol.steps![0]!);
    room.disconnect('s-c');
    expect(room.phase).toBe('paused');
    expect(room.combine('b', sol.steps![1]!).ok).toBe(false); // frozen while paused
    room.reconnect('c', 's-c2');
    const s = room.publicState();
    expect(s.phase).toBe('answering');
    expect(s.activePlayerId).toBe('b');
    expect(s.timer?.kind).toBe('answer');
    expect(s.timer?.durationMs).toBe(ANSWER_TIMEOUT_MS);
    expect(s.table).toHaveLength(3); // first combine kept
    room.combine('b', sol.steps![1]!);
    room.combine('b', sol.steps![2]!);
    expect(room.phase).toBe('hand-result');
    expect(room.lastResult?.solvedBy).toBe('b');
  });

  it('still forfeits the attempt if the answerer drops during that pause', () => {
    const room = startedRoom(['a', 'b', 'c']);
    seekSolvable(room, 'c');
    room.buzz('b');
    room.disconnect('s-c');
    room.disconnect('s-b');
    expect(room.phase).toBe('paused');
    expect(room.players.find((p) => p.id === 'b')!.lockedOut).toBe(true);
    room.reconnect('b', 's-b2');
    room.reconnect('c', 's-c2');
    expect(room.phase).toBe('open');
    expect(room.activePlayerId).toBeNull();
  });

  it('resumes open play on the hand clock that was left (bug: reset to 120 s)', () => {
    const room = startedRoom(['a', 'b']);
    vi.advanceTimersByTime(40_000);
    room.disconnect('s-b');
    vi.advanceTimersByTime(30_000); // time paused does not count
    room.reconnect('b', 's-b2');
    const t = room.publicState().timer!;
    expect(t.kind).toBe('hand-idle');
    expect(t.durationMs).toBe(HAND_IDLE_TIMEOUT_MS - 40_000);
  });

  it('gives at least the 15 s floor after a pause near the end of the clock', () => {
    const room = startedRoom(['a', 'b']);
    vi.advanceTimersByTime(HAND_IDLE_TIMEOUT_MS - 2_000);
    room.disconnect('s-b');
    room.reconnect('b', 's-b2');
    expect(room.publicState().timer!.durationMs).toBe(15_000);
  });
});

describe('host and seats after a match', () => {
  function finishedRoom(ev = events()): Room {
    const room = startedRoom(['a', 'b'], ev);
    for (let h = 0; h < 13; h++) {
      win(room, 'b');
      vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
    }
    expect(room.phase).toBe('match-result');
    return room;
  }

  it('hands host to a connected player when the host drops at match-result', () => {
    const room = finishedRoom();
    room.disconnect('s-a');
    expect(room.hostId).toBe('b');
    expect(room.playAgain('b')).toEqual({ ok: false, error: 'player-offline' });
    // After the grace the seat is freed; one player left goes back to the lobby.
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(room.players.map((p) => p.id)).toEqual(['b']);
    expect(room.phase).toBe('lobby');
    expect(room.closed).toBe(false);
  });

  it('frees the seat at once on an explicit leave, and closes when nobody is left', () => {
    const ev = events();
    const room = finishedRoom(ev);
    room.disconnect('s-a', { leaving: true });
    expect(room.phase).toBe('lobby');
    expect(room.hostId).toBe('b');
    room.disconnect('s-b', { leaving: true });
    expect(room.closed).toBe(true);
  });

  it('hands host on in the lobby too', () => {
    const room = new Room('ABCDEF', { id: 'a', name: 'A', socketId: 's-a' }, 'ffa', RULES, events());
    room.join({ id: 'b', name: 'B', socketId: 's-b' });
    room.disconnect('s-a');
    expect(room.hostId).toBe('b');
  });
});

describe('sudden death numbering', () => {
  it('numbers sudden-death hands 14, 15, ... in results and state', () => {
    const room = startedRoom(['a', 'b']);
    // Hand 1 times out (no points); then 12 hands split 6-6.
    vi.advanceTimersByTime(HAND_IDLE_TIMEOUT_MS);
    vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
    for (let h = 0; h < 12; h++) {
      win(room, h % 2 === 0 ? 'a' : 'b');
      vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
    }
    expect(room.isTiebreak).toBe(true);
    expect(room.publicState().handNumber).toBe(14);
    vi.advanceTimersByTime(HAND_IDLE_TIMEOUT_MS); // still tied
    expect(room.lastResult?.handNumber).toBe(14);
    vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
    expect(room.publicState().handNumber).toBe(15);
    win(room, 'a');
    expect(room.lastResult?.handNumber).toBe(15);
    vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
    expect(room.phase).toBe('match-result');
  });
});

describe('activity and ghost seats', () => {
  it('does not count timer-driven changes as activity', () => {
    const room = startedRoom(['a', 'b']);
    const last = room.lastActivity;
    vi.advanceTimersByTime(HAND_IDLE_TIMEOUT_MS * 6 + HAND_RESULT_DISPLAY_MS * 6);
    expect(room.lastActivity).toBe(last);
    expect(room.isIdle(Date.now(), 10 * 60_000)).toBe(true);
  });

  it('treats seats on sockets the server no longer has as disconnected', () => {
    const ev = events();
    const room = startedRoom(['a', 'b'], ev);
    room.dropDeadSockets(() => false);
    expect(room.phase).toBe('paused');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(room.closed).toBe(true);
  });

  it('marks a finished rated room as finished, not live', () => {
    const room = new Room('ABCDEF', { id: 'a', name: 'A', socketId: 's-a' }, 'ffa', RULES, events(), 'ranked');
    room.join({ id: 'b', name: 'B', socketId: 's-b' });
    room.start('a');
    expect(room.finished).toBe(false);
    for (let h = 0; h < 13; h++) {
      win(room, 'a');
      vi.advanceTimersByTime(HAND_RESULT_DISPLAY_MS);
    }
    expect(room.phase).toBe('match-result');
    expect(room.finished).toBe(true);
  });
});
