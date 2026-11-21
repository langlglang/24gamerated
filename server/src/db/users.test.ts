import { describe, expect, it } from 'vitest';
import { competitionRanks, isTestEmail, testEmailSql, TEST_EMAIL_PATTERN } from './users.js';

describe('isTestEmail', () => {
  it('matches example.test, any subdomain, any case, optional trailing dot', () => {
    for (const email of [
      'x@example.test',
      'x@EXAMPLE.TEST',
      'x@Example.Test',
      'x@example.test.',
      'x@qa.example.test',
      'x@a.b.example.test.',
      'x@QA.Example.Test.',
    ]) {
      expect(isTestEmail(email), email).toBe(true);
    }
  });

  it('does not match look-alike real domains', () => {
    for (const email of [
      'x@realmail.com',
      'x@notexample.test',
      'x@example.testing.com',
      'x@example.test.com',
      'x@example-test.com',
      'example.test@gmail.com',
      'x@example.tests',
    ]) {
      expect(isTestEmail(email), email).toBe(false);
    }
  });
});

describe('testEmailSql', () => {
  it('builds a case-insensitive regex test on the given column', () => {
    expect(testEmailSql('u.email_lower')).toBe(`(u.email_lower ~* '${TEST_EMAIL_PATTERN}')`);
    // Safe to embed in a single-quoted SQL literal.
    expect(TEST_EMAIL_PATTERN).not.toContain("'");
  });
});

describe('competitionRanks', () => {
  it('gives tied ratings the same rank and skips the places they take', () => {
    expect(competitionRanks([2000, 1900, 1900, 1800])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([2000, 2000, 2000])).toEqual([1, 1, 1]);
    expect(competitionRanks([1500, 1400, 1300])).toEqual([1, 2, 3]);
    expect(competitionRanks([])).toEqual([]);
  });
});
