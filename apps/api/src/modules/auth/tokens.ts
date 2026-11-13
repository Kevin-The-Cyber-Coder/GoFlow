import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import type { AuthConfig } from '../../config/auth';
import { ApiError } from '../../http/errors';

export interface AccessTokenPayload {
  readonly userId: string;
  readonly email: string;
}

interface JwtClaims {
  sub: string;
  email: string;
  typ: 'access';
}

export function signAccessToken(user: AccessTokenPayload, config: AuthConfig): string {
  const claims: JwtClaims = { sub: user.userId, email: user.email, typ: 'access' };
  return jwt.sign(claims, config.accessSecret, {
    expiresIn: config.accessTtlSeconds,
    issuer: config.issuer,
    audience: config.audience,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string, config: AuthConfig): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.accessSecret, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string' || decoded.typ !== 'access') {
      throw ApiError.unauthorized('Invalid access token.');
    }

    const { sub, email } = decoded as unknown as JwtClaims;
    if (typeof sub !== 'string' || typeof email !== 'string') {
      throw ApiError.unauthorized('Invalid access token.');
    }

    return { userId: sub, email };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw ApiError.unauthorized('The access token is invalid or has expired.');
  }
}

/** Opaque refresh token: 48 random bytes, base64url encoded. */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

/**
 * Refresh tokens are stored only as SHA-256 digests. Because the token is
 * high-entropy random data (not a password), a fast hash is sufficient and
 * lets us look the session up by digest in a single indexed query.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
