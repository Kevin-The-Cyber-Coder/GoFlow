import { describe, expect, it } from '@jest/globals';

import { loadAuthConfig } from './auth';

describe('loadAuthConfig', () => {
  it('provides development defaults', () => {
    const config = loadAuthConfig({});
    expect(config.accessTtlSeconds).toBe(900);
    expect(config.refreshTtlDays).toBe(30);
    expect(config.accessSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('requires a strong secret in production', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadAuthConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() =>
      loadAuthConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(32) }),
    ).not.toThrow();
  });

  it.each(['0', '-5', 'abc', '1.5'])('rejects invalid durations (%s)', (value) => {
    expect(() => loadAuthConfig({ JWT_ACCESS_TTL_SECONDS: value })).toThrow(
      /JWT_ACCESS_TTL_SECONDS/,
    );
  });
});
