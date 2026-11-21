import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetTicketKeyForTests,
  signSolveReceipt,
  signStartTicket,
  verifySolveReceipt,
  verifyStartTicket,
} from './ticket.js';

const DAY = '2026-11-21';
const DAY_START = Date.parse(`${DAY}T00:00:00Z`);
const ISSUED = DAY_START + 10 * 3_600_000; // 10:00 UTC
const LATER = ISSUED + 45_000;

describe('daily start tickets', () => {
  const saved = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = 'unit-test-secret-1234567890';
    resetTicketKeyForTests();
  });
  afterEach(() => {
    process.env.JWT_SECRET = saved;
    resetTicketKeyForTests();
  });

  it('round-trips: a genuine ticket gives back its issue time', () => {
    const t = signStartTicket(DAY, ISSUED);
    expect(t.startsWith(`v1.${DAY}.${ISSUED}.`)).toBe(true);
    expect(verifyStartTicket(t, DAY, LATER)).toBe(ISSUED);
    // Same inputs, same ticket.
    expect(signStartTicket(DAY, ISSUED)).toBe(t);
  });

  it('only counts for the day it was issued for', () => {
    const t = signStartTicket(DAY, ISSUED);
    expect(verifyStartTicket(t, '2026-11-20', LATER)).toBeNull();
    expect(verifyStartTicket(t, '2026-11-22', LATER)).toBeNull();
  });

  it('rejects a changed issue time (the forged "I started later" ticket)', () => {
    const t = signStartTicket(DAY, ISSUED);
    const [v, d, , mac] = t.split('.');
    const forged = `${v}.${d}.${ISSUED + 40_000}.${mac}`;
    expect(verifyStartTicket(forged, DAY, LATER)).toBeNull();
  });

  it('rejects a changed day with the original signature', () => {
    const t = signStartTicket(DAY, ISSUED);
    const moved = t.replace(DAY, '2026-11-22');
    expect(verifyStartTicket(moved, '2026-11-22', LATER + 86_400_000)).toBeNull();
  });

  it('rejects a tampered or truncated signature', () => {
    const t = signStartTicket(DAY, ISSUED);
    const last = t.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyStartTicket(t.slice(0, -1) + last, DAY, LATER)).toBeNull();
    expect(verifyStartTicket(t.slice(0, -4), DAY, LATER)).toBeNull();
  });

  it('rejects tickets signed with another secret', () => {
    const t = signStartTicket(DAY, ISSUED);
    process.env.JWT_SECRET = 'a-different-secret-0987654321';
    resetTicketKeyForTests();
    expect(verifyStartTicket(t, DAY, LATER)).toBeNull();
  });

  it('rejects issue times outside the day or in the future', () => {
    // Signed correctly, but not something our GET for that day could have issued.
    expect(verifyStartTicket(signStartTicket(DAY, DAY_START - 1), DAY, LATER)).toBeNull();
    expect(verifyStartTicket(signStartTicket(DAY, DAY_START + 86_400_000), DAY, LATER + 86_400_000)).toBeNull();
    expect(verifyStartTicket(signStartTicket(DAY, LATER + 1), DAY, LATER)).toBeNull();
    // Edges that are allowed.
    expect(verifyStartTicket(signStartTicket(DAY, DAY_START), DAY, LATER)).toBe(DAY_START);
    expect(verifyStartTicket(signStartTicket(DAY, LATER), DAY, LATER)).toBe(LATER);
  });

  it('never throws on junk', () => {
    for (const junk of [
      undefined,
      null,
      42,
      {},
      '',
      'v1',
      'v1...',
      `v2.${DAY}.${ISSUED}.abc`,
      `v1.${DAY}.-5.abc`,
      `v1.${DAY}.1e12.abc`,
      `v1.${DAY}.${ISSUED}.!!!`,
      `v1.${DAY}.${ISSUED}.abc.def`,
      `v1.garbage.${ISSUED}.abc`,
      'x'.repeat(10_000),
    ]) {
      expect(verifyStartTicket(junk, DAY, LATER)).toBeNull();
    }
  });

  it('refuses to sign an invalid day', () => {
    expect(() => signStartTicket('garbage', ISSUED)).toThrow(RangeError);
    expect(() => signStartTicket('2026-02-30', ISSUED)).toThrow(RangeError);
  });

  it('solve receipts round-trip and pin both times', () => {
    const r = signSolveReceipt(DAY, ISSUED, LATER);
    expect(verifySolveReceipt(r, DAY, LATER + 60_000)).toEqual({ startedAt: ISSUED, solvedAt: LATER });
    expect(verifySolveReceipt(r, '2026-11-22', LATER + 86_400_000)).toBeNull();
  });

  it('rejects receipts with moved times, a bad signature, or a future finish', () => {
    const r = signSolveReceipt(DAY, ISSUED, LATER);
    const [v, d, , , m] = r.split('.');
    // Claiming a later start (shorter time) or an earlier finish breaks the signature.
    expect(verifySolveReceipt(`${v}.${d}.${ISSUED + 30_000}.${LATER}.${m}`, DAY, LATER)).toBeNull();
    expect(verifySolveReceipt(`${v}.${d}.${ISSUED}.${LATER - 30_000}.${m}`, DAY, LATER)).toBeNull();
    expect(verifySolveReceipt(r.slice(0, -1) + (r.at(-1) === 'A' ? 'B' : 'A'), DAY, LATER)).toBeNull();
    expect(verifySolveReceipt(r, DAY, LATER - 1)).toBeNull();
    // A start ticket is not a receipt and vice versa.
    expect(verifySolveReceipt(signStartTicket(DAY, ISSUED), DAY, LATER)).toBeNull();
    expect(verifyStartTicket(r, DAY, LATER)).toBeNull();
    for (const junk of [undefined, null, 7, '', 'r1....', `r1.${DAY}.x.y.z`, 'y'.repeat(5000)]) {
      expect(verifySolveReceipt(junk, DAY, LATER)).toBeNull();
    }
    expect(() => signSolveReceipt(DAY, LATER, ISSUED)).toThrow(RangeError);
  });
});
