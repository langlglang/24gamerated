import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'unit-test-secret-1234567890';
let tokens: typeof import('./tokens.js');

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  tokens = await import('./tokens.js');
});

describe('verifyToken', () => {
  const id = '6cb8b387-1aa7-42ad-a552-f2cf52e5c8b8';

  it('accepts a token it issued', () => {
    const token = tokens.issueToken({ id, username: 'alice', password_hash: 'h' });
    expect(tokens.verifyToken(token)).toMatchObject({ userId: id, username: 'alice' });
  });

  it('rejects a validly signed token whose subject is not a UUID', () => {
    expect(tokens.verifyToken(jwt.sign({ username: 'x' }, SECRET, { subject: 'not-a-uuid' }))).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    expect(tokens.verifyToken(jwt.sign({ username: 'x' }, 'other-secret-abcdefgh', { subject: id }))).toBeNull();
  });
});
