import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import { unauthorized } from './errors';

export interface TokenServiceConfig {
  /** HS256 secret. Must be at least 32 characters; enforced by config loading. */
  secret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  issuer?: string;
  audience?: string;
}

export interface RefreshTokenMaterial {
  /** The value given to the client. Never stored. */
  token: string;
  /** What the database stores. */
  tokenHash: string;
  /** Rotation chain identifier. */
  familyId: string;
  expiresAt: Date;
}

export class TokenService {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly config: TokenServiceConfig) {
    this.key = new TextEncoder().encode(config.secret);
    this.issuer = config.issuer ?? 'goflow';
    this.audience = config.audience ?? 'goflow-api';
  }

  async issueAccessToken(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.accessTokenTtlSeconds)
      .sign(this.key);
  }

  /** Throws a 401 AppError for anything invalid: signature, issuer, expiry. */
  async verifyAccessToken(token: string): Promise<{ userId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
      });

      if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
        throw new Error('Unexpected token claims.');
      }

      return { userId: payload.sub };
    } catch {
      throw unauthorized('Invalid or expired access token.', 'INVALID_TOKEN');
    }
  }

  /**
   * Refresh tokens are opaque 256-bit values. There is no reason to make them
   * JWTs: they are looked up in the database on every use anyway, and opacity
   * means a leaked token cannot be inspected for claims.
   */
  createRefreshToken(familyId: string = randomUUID()): RefreshTokenMaterial {
    const token = randomBytes(32).toString('base64url');

    return {
      token,
      tokenHash: hashToken(token),
      familyId,
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
    };
  }

  get refreshTokenTtlSeconds(): number {
    return this.config.refreshTokenTtlSeconds;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
