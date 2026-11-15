import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../app';
import { getPrisma } from '../../database/client';
import { resetDatabase } from '../../test-utils/db';

const app = createApp();
const prisma = getPrisma();

interface Session {
  accessToken: string;
  workspaceId: string;
  userId: string;
  email: string;
}

let counter = 0;

async function registerUser(): Promise<Session> {
  counter += 1;
  const email = `audit${counter}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassword!', name: `User ${counter}` });
  expect(response.status).toBe(201);
  return {
    accessToken: response.body.tokens.accessToken as string,
    workspaceId: response.body.workspace.workspaceId as string,
    userId: response.body.user.id as string,
    email,
  };
}

function api(session: Session) {
  const auth = (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Workspace-Id', session.workspaceId);

  return {
    get: (path: string) => auth(request(app).get(`/api/v1${path}`)),
    post: (path: string) => auth(request(app).post(`/api/v1${path}`)),
    patch: (path: string) => auth(request(app).patch(`/api/v1${path}`)),
  };
}

async function createClient(session: Session, name: string): Promise<string> {
  const response = await api(session).post('/clients').send({ name, status: 'ACTIVE' });
  expect(response.status).toBe(201);
  return response.body.client.id as string;
}

describe('audit log', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns the workspace trail newest first with the actor attached', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner, 'Acme Technologies');

    const response = await api(owner).get('/audit?action=client.created');

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      hasNext: false,
    });

    const [entry] = response.body.entries;
    expect(entry).toMatchObject({
      action: 'client.created',
      entityType: 'Client',
      entityId: clientId,
      actorId: owner.userId,
      actorEmail: owner.email,
      metadata: { name: 'Acme Technologies' },
    });
    expect(typeof entry.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(entry.createdAt))).toBe(false);

    const update = await api(owner).patch(`/clients/${clientId}`).send({ name: 'Acme Ltd' });
    expect(update.status).toBe(200);

    const trail = await api(owner).get('/audit');
    expect(trail.body.meta.total).toBe(3); // auth.registered, client.created, client.updated
    expect(trail.body.entries.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining(['auth.registered', 'client.created', 'client.updated']),
    );
  });

  it('filters by action, entity type, entity id and actor', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner, 'Filterable');
    await createClient(owner, 'Other');

    expect((await api(owner).get('/audit?action=client.updated')).body.meta.total).toBe(0);

    const byEntity = await api(owner).get('/audit?entityType=Client');
    expect(byEntity.body.meta.total).toBe(2);

    const byId = await api(owner).get(`/audit?entityId=${clientId}`);
    expect(byId.body.meta.total).toBe(1);
    expect(byId.body.entries[0].entityId).toBe(clientId);

    const byActor = await api(owner).get(`/audit?actorId=${owner.userId}`);
    expect(byActor.body.meta.total).toBe(3); // auth.registered plus both clients
    expect(byActor.body.entries.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining(['auth.registered', 'client.created']),
    );

    const unknownActor = await api(owner).get(
      '/audit?actorId=00000000-0000-4000-8000-000000000000',
    );
    expect(unknownActor.status).toBe(200);
    expect(unknownActor.body.entries).toEqual([]);
  });

  it('searches action, entity type and actor e-mail case-insensitively', async () => {
    const owner = await registerUser();
    await createClient(owner, 'Searchable');

    const byAction = await api(owner).get('/audit?search=CLIENT.CRE');
    expect(byAction.body.meta.total).toBe(1);

    const byActor = await api(owner).get(
      `/audit?search=${encodeURIComponent(owner.email.split('@')[0])}`,
    );
    expect(byActor.body.meta.total).toBeGreaterThanOrEqual(1);

    const missing = await api(owner).get('/audit?search=nothing-matches-this');
    expect(missing.body.meta.total).toBe(0);
    expect(missing.body.entries).toEqual([]);
  });

  it('filters by date range and includes the whole of the end day', async () => {
    const owner = await registerUser();
    await prisma.auditLog.createMany({
      data: [
        {
          workspaceId: owner.workspaceId,
          actorId: owner.userId,
          actorEmail: owner.email,
          action: 'test.old',
          entityType: 'Test',
          createdAt: new Date('2026-01-05T10:00:00.000Z'),
        },
        {
          workspaceId: owner.workspaceId,
          actorId: owner.userId,
          actorEmail: owner.email,
          action: 'test.edge',
          entityType: 'Test',
          createdAt: new Date('2026-02-10T23:59:00.000Z'),
        },
        {
          workspaceId: owner.workspaceId,
          actorId: owner.userId,
          actorEmail: owner.email,
          action: 'test.later',
          entityType: 'Test',
          createdAt: new Date('2026-03-01T00:00:01.000Z'),
        },
      ],
    });

    const range = await api(owner).get('/audit?from=2026-02-01&to=2026-02-10');
    expect(range.body.entries.map((item: { action: string }) => item.action)).toEqual([
      'test.edge',
    ]);

    const openEnded = await api(owner).get('/audit?from=2026-02-11&to=2026-03-01');
    expect(openEnded.body.entries.map((item: { action: string }) => item.action)).toEqual([
      'test.later',
    ]);

    const reverse = await api(owner).get('/audit?from=2026-03-01&to=2026-02-01');
    expect(reverse.body.entries).toEqual([]);
  });

  it('paginates without repeating or skipping entries', async () => {
    const owner = await registerUser();
    for (const name of ['One', 'Two', 'Three']) {
      await createClient(owner, name);
    }

    const first = await api(owner).get('/audit?entityType=Client&pageSize=2&page=1');
    expect(first.body.meta).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNext: true,
    });
    expect(first.body.entries).toHaveLength(2);

    const second = await api(owner).get('/audit?entityType=Client&pageSize=2&page=2');
    expect(second.body.meta).toMatchObject({ page: 2, total: 3, hasNext: false });
    expect(second.body.entries).toHaveLength(1);

    const ids = [...first.body.entries, ...second.body.entries].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it('requires audit:read and never returns another workspace trail', async () => {
    const owner = await registerUser();
    const employee = await registerUser();
    const accountant = await registerUser();
    const stranger = await registerUser();

    await prisma.workspaceMember.createMany({
      data: [
        {
          workspaceId: owner.workspaceId,
          userId: employee.userId,
          role: 'EMPLOYEE',
          acceptedAt: new Date(),
        },
        {
          workspaceId: owner.workspaceId,
          userId: accountant.userId,
          role: 'ACCOUNTANT',
          acceptedAt: new Date(),
        },
      ],
    });

    const ownerClient = await createClient(owner, 'Owned by owner');
    const strangerClient = await createClient(stranger, 'Owned by stranger');

    expect((await api({ ...employee, workspaceId: owner.workspaceId }).get('/audit')).status).toBe(
      403,
    );

    const shared = await api({ ...accountant, workspaceId: owner.workspaceId }).get('/audit');
    expect(shared.status).toBe(200);
    expect(shared.body.meta.total).toBe(2); // auth.registered and client.created
    expect(
      shared.body.entries.some((entry: { entityId: string }) => entry.entityId === ownerClient),
    ).toBe(true);

    const foreign = await api({ ...stranger, workspaceId: owner.workspaceId }).get('/audit');
    expect(foreign.status).toBe(404);

    const ownTrail = await api(stranger).get('/audit');
    expect(ownTrail.body.meta.total).toBe(2);
    expect(
      ownTrail.body.entries.map((entry: { entityId: string | null }) => entry.entityId),
    ).toContain(strangerClient);
    expect(
      ownTrail.body.entries.map((entry: { entityId: string | null }) => entry.entityId),
    ).not.toContain(ownerClient);
  });

  it('rejects invalid filters', async () => {
    const owner = await registerUser();

    const impossibleDate = await api(owner).get('/audit?from=2026-02-31');
    expect(impossibleDate.status).toBe(400);

    const oversizedPage = await api(owner).get('/audit?pageSize=500');
    expect(oversizedPage.status).toBe(400);

    const badActor = await api(owner).get('/audit?actorId=not-a-uuid');
    expect(badActor.status).toBe(400);
  });
});
