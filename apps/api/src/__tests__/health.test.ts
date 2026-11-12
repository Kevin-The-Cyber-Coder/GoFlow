import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createTestContext, type TestContext } from './helpers/test-app';

describe('the HTTP surface', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('reports the service as healthy', async () => {
    const response = await request(context.app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'ok' });
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a consistent error envelope for unknown routes', async () => {
    const response = await request(context.app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/v1/does-not-exist does not exist.',
      },
    });
  });
});
