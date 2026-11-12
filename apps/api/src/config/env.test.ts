import { describe, expect, it } from '@jest/globals';

import { loadConfig } from './env';

const base = {
  DATABASE_URL: 'postgresql://goflow:goflow@localhost:5432/goflow',
  JWT_SECRET: 'a-secret-that-is-long-enough-for-hs256',
};

describe('loadConfig', () => {
  it('applies development defaults', () => {
    expect(loadConfig(base)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: base.DATABASE_URL,
      jwtSecret: base.JWT_SECRET,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2_592_000,
    });
  });

  it('reads explicit values', () => {
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        PORT: '8080',
        ACCESS_TOKEN_TTL_SECONDS: '60',
        REFRESH_TOKEN_TTL_SECONDS: '120',
      }),
    ).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 120,
    });
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('requires JWT_SECRET', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET is required/);
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'too-short' })).toThrow(/at least 32/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrow(/Invalid NODE_ENV/);
  });

  it('rejects a non-positive token lifetime', () => {
    expect(() => loadConfig({ ...base, ACCESS_TOKEN_TTL_SECONDS: '0' })).toThrow(
      /Invalid ACCESS_TOKEN_TTL_SECONDS/,
    );
  });

  it.each(['0', '-1', '65536', 'abc', '3.5'])('rejects the invalid PORT %s', (port) => {
    expect(() => loadConfig({ ...base, PORT: port })).toThrow(/Invalid PORT/);
  });
});
