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
});
