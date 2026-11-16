import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../app';

type Env = Record<string, string | undefined>;

/**
 * Runs `fn` with the given environment overrides and restores the previous
 * values afterwards, because `createApp` reads its security configuration from
 * `process.env` when it is called.
 */
async function withEnv<T>(overrides: Env, fn: () => Promise<T> | T): Promise<T> {
  const previous: Env = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('security middleware', () => {
  it('sets hardening headers and hides the framework', async () => {
    const response = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['referrer-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('adds CORS headers only for allowlisted origins', async () => {
    await withEnv({ CORS_ORIGINS: 'http://localhost:5173, https://app.goflow.test ' }, async () => {
      const app = createApp();

      const allowed = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

      const denied = await request(app).get('/api/v1/health').set('Origin', 'http://evil.test');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();

      // No Origin header is not a cross-origin browser request.
      const server = await request(app).get('/api/v1/health');
      expect(server.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('allows no cross-origin access when CORS_ORIGINS is empty', async () => {
    await withEnv({ CORS_ORIGINS: undefined }, async () => {
      const response = await request(createApp())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('answers a preflight for an allowlisted origin', async () => {
    await withEnv({ CORS_ORIGINS: 'http://localhost:5173' }, async () => {
      const response = await request(createApp())
        .options('/api/v1/clients')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-workspace-id');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']).toContain('X-Workspace-Id');
      expect(response.headers['access-control-max-age']).toBe('600');
    });
  });

  it('returns the standard envelope when the API limit is exceeded', async () => {
    await withEnv({ NODE_ENV: 'test', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_MAX: '2' }, async () => {
      const app = createApp();

      // Health is mounted before the limiter and must stay unlimited.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await request(app).get('/api/v1/health')).status).toBe(200);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const allowed = await request(app).get('/api/v1/workspaces');
        expect(allowed.status).not.toBe(429);
        expect(allowed.headers['ratelimit']).toBeDefined();
      }

      const blocked = await request(app).get('/api/v1/workspaces');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.body.error.message).toContain('Too many requests');
    });
  });

  it('applies a stricter limit to authentication routes', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        RATE_LIMIT_ENABLED: '1',
        RATE_LIMIT_MAX: '300',
        AUTH_RATE_LIMIT_MAX: '2',
      },
      async () => {
        const app = createApp();

        // An empty body is rejected by validation before any database work, so
        // these attempts only exercise the limiter.
        expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
        expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);

        const blocked = await request(app).post('/api/v1/auth/login').send({});
        expect(blocked.status).toBe(429);
        expect(blocked.body.error.code).toBe('RATE_LIMITED');
        expect(blocked.body.error.message).toContain('authentication');
      },
    );
  });

  it('leaves rate limiting off under test unless it is enabled', async () => {
    await withEnv(
      { NODE_ENV: 'test', RATE_LIMIT_ENABLED: undefined, RATE_LIMIT_MAX: '1' },
      async () => {
        const app = createApp();

        for (let attempt = 0; attempt < 3; attempt += 1) {
          expect((await request(app).get('/api/v1/workspaces')).status).not.toBe(429);
        }
      },
    );
  });

  it('fails fast on an invalid limit', async () => {
    await withEnv({ NODE_ENV: 'test', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_MAX: '0' }, () => {
      expect(() => createApp()).toThrow(/Invalid RATE_LIMIT_MAX/);
    });

    await withEnv({ NODE_ENV: 'test', RATE_LIMIT_ENABLED: '1', AUTH_RATE_LIMIT_MAX: 'ten' }, () => {
      expect(() => createApp()).toThrow(/Invalid AUTH_RATE_LIMIT_MAX/);
    });
  });
});
