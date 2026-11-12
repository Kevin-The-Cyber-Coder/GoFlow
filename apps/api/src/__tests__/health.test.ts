import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../app';

describe('GET /api/v1/health', () => {
  it('reports the service as healthy', async () => {
    const response = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('returns a consistent error envelope', async () => {
    const response = await request(createApp()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/v1/does-not-exist does not exist.',
      },
    });
  });
});
