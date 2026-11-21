import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import {
  BCRYPT_ROUNDS,
  DUMMY_HASH,
  hashPassword,
  readStringFields,
  validateEmail,
  validateLoginIdentifier,
  validatePassword,
  verifyPassword,
  verifyPasswordConstantTime,
} from './credentials.js';

describe('validatePassword', () => {
  it('enforces the minimum length', () => {
    expect(validatePassword('1234567')?.field).toBe('password');
    expect(validatePassword('12345678')).toBeNull();
  });

  it('allows exactly 72 bytes and rejects 73', () => {
    expect(validatePassword('a'.repeat(72))).toBeNull();
    expect(validatePassword('a'.repeat(73))?.message).toMatch(/too long/);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // '€' is 3 bytes: 24 of them is 72 bytes, 25 is 75.
    expect(validatePassword('€'.repeat(24))).toBeNull();
    expect(validatePassword('€'.repeat(25))?.field).toBe('password');
    // An emoji is 4 bytes (2 UTF-16 units): 18 fit, 19 do not.
    expect(validatePassword('😀'.repeat(18))).toBeNull();
    expect(validatePassword('😀'.repeat(19))).not.toBeNull();
  });
});

describe('validateEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('  first.last+tag@example.com ')).toBeNull();
  });

  it('rejects missing, malformed and overlong addresses', () => {
    expect(validateEmail('')?.message).toMatch(/required/);
    expect(validateEmail('a@b')).not.toBeNull();
    expect(validateEmail('not-an-email')).not.toBeNull();
    expect(validateEmail('a'.repeat(195) + '@ex.com')?.message).toMatch(/too long/);
  });

  it('rejects control characters, including NUL', () => {
    for (const ch of ['\u0000', '\u0007', '\u001b', '\u007f', '\u0085']) {
      expect(validateEmail(`a${ch}b@ex.com`), JSON.stringify(ch)).not.toBeNull();
    }
  });
});

describe('validateLoginIdentifier', () => {
  it('accepts usernames and emails', () => {
    expect(validateLoginIdentifier('alice')).toBeNull();
    expect(validateLoginIdentifier('alice@example.com')).toBeNull();
  });

  it('rejects empty, overlong and control-character identifiers', () => {
    expect(validateLoginIdentifier('')).not.toBeNull();
    expect(validateLoginIdentifier('   ')).not.toBeNull();
    expect(validateLoginIdentifier('x'.repeat(201))).not.toBeNull();
    expect(validateLoginIdentifier('a\u0000b')).not.toBeNull();
    expect(validateLoginIdentifier('a\nb@ex.com')).not.toBeNull();
  });
});

describe('readStringFields', () => {
  it('reads strings and treats missing or null as empty', () => {
    expect(readStringFields({ a: 'x', b: null }, ['a', 'b', 'c'])).toEqual({
      ok: true,
      values: { a: 'x', b: '', c: '' },
    });
  });

  it('tolerates a body that is not an object', () => {
    expect(readStringFields(undefined, ['a'])).toEqual({ ok: true, values: { a: '' } });
    expect(readStringFields('text', ['a'])).toEqual({ ok: true, values: { a: '' } });
  });

  it('rejects arrays, objects, numbers and booleans', () => {
    for (const bad of [['x'], { a: 1 }, 12345, true, false, 0]) {
      expect(readStringFields({ a: 'ok', b: bad }, ['a', 'b']), JSON.stringify(bad)).toEqual({
        ok: false,
        field: 'b',
      });
    }
  });

  it('ignores inherited properties', () => {
    const body = Object.create({ a: ['inherited'] }) as Record<string, unknown>;
    expect(readStringFields(body, ['a'])).toEqual({ ok: true, values: { a: '' } });
  });
});

describe('password hashing', () => {
  it('uses the same cost for the dummy hash as for real ones', async () => {
    expect(bcrypt.getRounds(DUMMY_HASH)).toBe(BCRYPT_ROUNDS);
    expect(bcrypt.getRounds(await hashPassword('password123'))).toBe(BCRYPT_ROUNDS);
  });

  it('verifyPasswordConstantTime is false without a hash and correct with one', async () => {
    const hash = await hashPassword('password123');
    expect(await verifyPasswordConstantTime('password123', hash)).toBe(true);
    expect(await verifyPasswordConstantTime('wrong-password', hash)).toBe(false);
    expect(await verifyPasswordConstantTime('password123', null)).toBe(false);
    expect(await verifyPasswordConstantTime('', undefined)).toBe(false);
  });

  it('still verifies a pre-existing password longer than 72 bytes', async () => {
    // Accounts created before the byte limit keep logging in with the full password.
    const long = 'a'.repeat(200);
    const hash = await hashPassword(long);
    expect(await verifyPassword(long, hash)).toBe(true);
    expect(await verifyPasswordConstantTime(long, hash)).toBe(true);
  });
});
