import { describe, expect, it } from '@jest/globals';

import { loadAuthConfig } from '../../config/auth';
import { ApiError } from '../../http/errors';
import { hashPassword, MAX_PASSWORD_BYTES, verifyPassword } from './password';
import { createRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from './tokens';

const config = loadAuthConfig({});

describe('password hashing', () => {
  it('never stores the plaintext password', async () => {
    const hash = await hashPassword('Password123!');
    expect(hash).not.toContain('Password123!');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('verifies the correct password and rejects others', async () => {
    const hash = await hashPassword('Password123!');
    await expect(verifyPassword(hash, 'Password123!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'Password123?')).resolves.toBe(false);
  });

  it('produces a different hash for the same password (salt)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('Password123!'),
      hashPassword('Password123!'),
    ]);
    expect(first).not.toBe(second);
  });

  it('rejects inputs beyond the bcrypt 72-byte limit', async () => {
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_BYTES + 1))).rejects.toThrow(/72 bytes/);
  });
});

describe('access tokens', () => {
  it('round-trips the user identity', () => {
    const token = signAccessToken({ userId: 'user-1', email: 'a@example.test' }, config);
    expect(verifyAccessToken(token, config)).toEqual({
      userId: 'user-1',
      email: 'a@example.test',
    });
  });

  it('rejects a token signed with another secret', () => {
    const token = signAccessToken({ userId: 'user-1', email: 'a@example.test' }, config);
    expect(() => verifyAccessToken(token, { ...config, accessSecret: 'y'.repeat(40) })).toThrow(
      ApiError,
    );
  });

  it('rejects a token for another audience', () => {
    const token = signAccessToken({ userId: 'user-1', email: 'a@example.test' }, config);
    expect(() => verifyAccessToken(token, { ...config, audience: 'other-app' })).toThrow(
      /invalid or has expired/,
    );
  });

  it('rejects tampered payloads', () => {
    const token = signAccessToken({ userId: 'user-1', email: 'a@example.test' }, config);
    const [header, , signature] = token.split('.');
    const forged = `${header}.${Buffer.from('{"sub":"admin"}').toString('base64url')}.${signature}`;
    expect(() => verifyAccessToken(forged, config)).toThrow(ApiError);
  });

  it('rejects an expired token', () => {
    const token = signAccessToken(
      { userId: 'user-1', email: 'a@example.test' },
      {
        ...config,
        accessTtlSeconds: -1,
      },
    );
    expect(() => verifyAccessToken(token, config)).toThrow(/invalid or has expired/);
  });
});

describe('refresh tokens', () => {
  it('generates high-entropy opaque tokens', () => {
    const { token, tokenHash } = createRefreshToken();
    expect(token.length).toBeGreaterThanOrEqual(60);
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toBe(hashRefreshToken(token));
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createRefreshToken().token));
    expect(tokens.size).toBe(100);
  });
});
