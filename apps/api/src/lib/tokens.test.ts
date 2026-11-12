import { describe, expect, it } from '@jest/globals';

import { AppError } from './errors';
import { TokenService, hashToken } from './tokens';

const config = {
  secret: 'a-test-secret-that-is-at-least-32-characters',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 3_600,
};

describe('TokenService', () => {
  const tokens = new TokenService(config);

  it('issues an access token that verifies', async () => {
    const token = await tokens.issueAccessToken('user-1');

    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ userId: 'user-1' });
  });

  it('rejects a token signed with another secret', async () => {
    const other = new TokenService({
      ...config,
      secret: 'another-secret-that-is-also-long-enough',
    });
    const token = await other.issueAccessToken('user-1');

    await expect(tokens.verifyAccessToken(token)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a tampered token', async () => {
    const token = await tokens.issueAccessToken('user-1');
    const tampered = `${token.slice(0, -2)}xx`;

    await expect(tokens.verifyAccessToken(tampered)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired token', async () => {
    const expiring = new TokenService({ ...config, accessTokenTtlSeconds: -1 });
    const token = await expiring.issueAccessToken('user-1');

    await expect(tokens.verifyAccessToken(token)).rejects.toMatchObject({ status: 401 });
  });

  it('creates opaque refresh tokens with a stable hash', () => {
    const material = tokens.createRefreshToken();

    expect(material.token).not.toContain('.');
    expect(material.tokenHash).toBe(hashToken(material.token));
    expect(material.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates a fresh family unless one is supplied', () => {
    const first = tokens.createRefreshToken();
    const second = tokens.createRefreshToken();
    const rotated = tokens.createRefreshToken(first.familyId);

    expect(first.familyId).not.toBe(second.familyId);
    expect(rotated.familyId).toBe(first.familyId);
  });
});
