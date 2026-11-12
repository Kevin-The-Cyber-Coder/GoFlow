import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import type { Express } from 'express';

import { createTestContext, resetDatabase, type TestContext } from './helpers/test-app';

interface Session {
  token: string;
  workspaceId: string;
}

async function register(app: Express, email = 'kevin@example.com'): Promise<Session> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'correct-horse-battery-staple', name: 'Kevin' });

  return {
    token: response.body.data.accessToken,
    workspaceId: response.body.data.workspace.id,
  };
}

function authorized(request_: request.Test, session: Session): request.Test {
  return request_.set('Authorization', `Bearer ${session.token}`);
}

describe('clients', () => {
  let context: TestContext;
  let session: Session;

  beforeAll(async () => {
    context = await createTestContext();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await resetDatabase(context.db);
    session = await register(context.app);
  });

  describe('POST /api/v1/clients', () => {
    it('creates a client and normalises optional fields', async () => {
      const response = await authorized(request(context.app).post('/api/v1/clients'), session).send(
        {
          name: 'Acme Studio',
          email: 'Billing@Acme.example',
          country: 'gb',
          phone: '',
        },
      );

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        name: 'Acme Studio',
        email: 'billing@acme.example',
        country: 'GB',
        phone: null,
        company: null,
        archivedAt: null,
      });
      expect(typeof response.body.data.id).toBe('string');
      expect(typeof response.body.data.createdAt).toBe('string');
    });

    it('requires authentication', async () => {
      const response = await request(context.app).post('/api/v1/clients').send({ name: 'Acme' });

      expect(response.status).toBe(401);
    });

    it('rejects an invalid payload with field details', async () => {
      const response = await authorized(request(context.app).post('/api/v1/clients'), session).send(
        {
          name: '',
          email: 'not-an-email',
        },
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'name' }),
          expect.objectContaining({ path: 'email' }),
        ]),
      );
    });

    it('rejects unknown fields', async () => {
      const response = await authorized(request(context.app).post('/api/v1/clients'), session).send(
        {
          name: 'Acme',
          isAdmin: true,
        },
      );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/clients', () => {
    beforeEach(async () => {
      for (const name of ['Zenith Labs', 'Acme Studio', 'Beta Works']) {
        await authorized(request(context.app).post('/api/v1/clients'), session).send({
          name,
          company: `${name} Ltd`,
        });
      }
    });

    it('lists clients by name with pagination metadata', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/clients?limit=2'),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ total: 3, limit: 2, offset: 0 });
      expect(response.body.data.items).toHaveLength(2);
      expect(response.body.data.items.map((item: { name: string }) => item.name)).toEqual([
        'Acme Studio',
        'Beta Works',
      ]);
    });

    it('searches names and companies case-insensitively', async () => {
      const byName = await authorized(
        request(context.app).get('/api/v1/clients?search=zenith'),
        session,
      );
      const byCompany = await authorized(
        request(context.app).get('/api/v1/clients?search=ltd'),
        session,
      );

      expect(byName.body.data.items).toHaveLength(1);
      expect(byName.body.data.items[0].name).toBe('Zenith Labs');
      expect(byCompany.body.data.total).toBe(3);
    });

    it('treats LIKE wildcards in the search term literally', async () => {
      await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: '100% Studio',
      });

      const response = await authorized(
        request(context.app).get('/api/v1/clients?search=%25'),
        session,
      );

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].name).toBe('100% Studio');
    });

    it('validates pagination parameters', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/clients?limit=500'),
        session,
      );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/clients/:id', () => {
    it('returns a client from the same workspace', async () => {
      const created = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
      });

      const response = await authorized(
        request(context.app).get(`/api/v1/clients/${created.body.data.id}`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Acme Studio');
    });

    it('returns 404 for an unknown client', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/clients/00000000-0000-4000-8000-000000000000'),
        session,
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for a malformed id instead of a database error', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/clients/not-a-uuid'),
        session,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CLIENT_ID');
    });
  });

  describe('PATCH /api/v1/clients/:id', () => {
    it('updates fields and can clear an optional value', async () => {
      const created = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
        email: 'billing@acme.example',
      });

      const response = await authorized(
        request(context.app).patch(`/api/v1/clients/${created.body.data.id}`),
        session,
      ).send({ company: 'Acme Holdings', email: null });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        name: 'Acme Studio',
        company: 'Acme Holdings',
        email: null,
      });
      expect(new Date(response.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.body.data.updatedAt).getTime(),
      );
    });

    it('rejects an empty patch', async () => {
      const created = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
      });

      const response = await authorized(
        request(context.app).patch(`/api/v1/clients/${created.body.data.id}`),
        session,
      ).send({});

      expect(response.status).toBe(400);
    });
  });

  describe('archiving', () => {
    it('hides an archived client from the list but keeps it readable', async () => {
      const created = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
      });
      const id = created.body.data.id;

      const archived = await authorized(
        request(context.app).delete(`/api/v1/clients/${id}`),
        session,
      );
      expect(archived.status).toBe(204);

      const list = await authorized(request(context.app).get('/api/v1/clients'), session);
      expect(list.body.data.items).toHaveLength(0);

      const withArchived = await authorized(
        request(context.app).get('/api/v1/clients?includeArchived=true'),
        session,
      );
      expect(withArchived.body.data.items).toHaveLength(1);

      const fetched = await authorized(request(context.app).get(`/api/v1/clients/${id}`), session);
      expect(fetched.status).toBe(200);
      expect(fetched.body.data.archivedAt).toEqual(expect.any(String));
    });

    it('restores an archived client', async () => {
      const created = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
      });
      const id = created.body.data.id;

      await authorized(request(context.app).delete(`/api/v1/clients/${id}`), session);
      const restored = await authorized(
        request(context.app).post(`/api/v1/clients/${id}/restore`),
        session,
      );

      expect(restored.status).toBe(200);
      expect(restored.body.data.archivedAt).toBeNull();
    });
  });

  describe('workspace isolation', () => {
    it('does not expose another workspace client', async () => {
      const created = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
      });

      const other = await register(context.app, 'other@example.com');

      const read = await authorized(
        request(context.app).get(`/api/v1/clients/${created.body.data.id}`),
        other,
      );
      const list = await authorized(request(context.app).get('/api/v1/clients'), other);
      const update = await authorized(
        request(context.app).patch(`/api/v1/clients/${created.body.data.id}`),
        other,
      ).send({ name: 'Stolen' });

      expect(read.status).toBe(404);
      expect(list.body.data.items).toHaveLength(0);
      expect(update.status).toBe(404);
    });

    it('rejects a workspace the caller does not belong to', async () => {
      const other = await register(context.app, 'other@example.com');

      const response = await authorized(request(context.app).get('/api/v1/clients'), other).set(
        'X-Workspace-Id',
        session.workspaceId,
      );

      expect(response.status).toBe(403);
    });

    it('rejects a malformed workspace header', async () => {
      const response = await authorized(request(context.app).get('/api/v1/clients'), session).set(
        'X-Workspace-Id',
        'not-a-uuid',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_WORKSPACE_HEADER');
    });
  });
});
