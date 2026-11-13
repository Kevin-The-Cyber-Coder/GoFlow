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

async function registerUser(currency = 'USD'): Promise<Session> {
  counter += 1;
  const email = `project${counter}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassword!', name: `Project ${counter}`, currency });
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
    delete: (path: string) => auth(request(app).delete(`/api/v1${path}`)),
  };
}

async function createClient(session: Session, name = 'Acme'): Promise<string> {
  const response = await api(session).post('/clients').send({ name });
  expect(response.status).toBe(201);
  return response.body.client.id as string;
}

describe('projects', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a project with the workspace currency and audits it', async () => {
    const owner = await registerUser('ZAR');
    const clientId = await createClient(owner);

    const response = await api(owner).post('/projects').send({
      clientId,
      name: 'Website redesign',
      description: 'Marketing site',
      priority: 'HIGH',
      startDate: '2026-02-01',
      dueDate: '2026-03-15',
      budgetMinor: '2500000',
    });

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({
      name: 'Website redesign',
      status: 'PLANNING',
      priority: 'HIGH',
      startDate: '2026-02-01',
      dueDate: '2026-03-15',
      budgetMinor: '2500000',
      currency: 'ZAR',
      counts: { tasks: 0, timeEntries: 0, invoices: 0 },
    });

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: 'project.created' },
    });
    expect(audit?.entityType).toBe('Project');
  });

  it('rejects a client that belongs to another workspace', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const foreignClientId = await createClient(stranger, 'Foreign');

    const response = await api(owner)
      .post('/projects')
      .send({ clientId: foreignClientId, name: 'Nope' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('validates dates and amounts', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner);

    const inverted = await api(owner)
      .post('/projects')
      .send({ clientId, name: 'Backwards', startDate: '2026-03-01', dueDate: '2026-02-01' });
    expect(inverted.status).toBe(400);

    const impossible = await api(owner)
      .post('/projects')
      .send({ clientId, name: 'Impossible', dueDate: '2026-02-31' });
    expect(impossible.status).toBe(400);

    const negative = await api(owner)
      .post('/projects')
      .send({ clientId, name: 'Negative', budgetMinor: '-100' });
    expect(negative.status).toBe(400);
  });

  it('filters, searches and paginates, hiding archived projects by default', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner);
    for (let index = 0; index < 5; index += 1) {
      await api(owner)
        .post('/projects')
        .send({
          clientId,
          name: `Project ${index}`,
          status: index % 2 === 0 ? 'IN_PROGRESS' : 'PLANNING',
        });
    }

    const page = await api(owner).get('/projects?pageSize=2&sort=name&order=asc');
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ total: 5, totalPages: 3 });

    const filtered = await api(owner).get('/projects?status=IN_PROGRESS');
    expect(filtered.body.meta.total).toBe(3);

    const searched = await api(owner).get('/projects?search=project%204');
    expect(searched.body.meta.total).toBe(1);

    const archivedId = page.body.data[0].id as string;
    await api(owner).post(`/projects/${archivedId}/archive`);
    expect((await api(owner).get('/projects')).body.meta.total).toBe(4);
    expect((await api(owner).get('/projects?includeArchived=true')).body.meta.total).toBe(5);
    await api(owner).post(`/projects/${archivedId}/restore`);
    expect((await api(owner).get('/projects')).body.meta.total).toBe(5);
  });

  it('aggregates time, billable value, invoiced totals and budget remaining', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner);
    const created = await api(owner)
      .post('/projects')
      .send({ clientId, name: 'Retainer', budgetMinor: '1000000' });
    const projectId = created.body.project.id as string;

    await prisma.timeEntry.createMany({
      data: [
        {
          workspaceId: owner.workspaceId,
          projectId,
          userId: owner.userId,
          minutes: 90,
          billable: true,
          hourlyRateMinor: 60_000n,
          date: new Date('2026-02-02T00:00:00Z'),
        },
        {
          workspaceId: owner.workspaceId,
          projectId,
          userId: owner.userId,
          minutes: 30,
          billable: false,
          hourlyRateMinor: 60_000n,
          date: new Date('2026-02-03T00:00:00Z'),
        },
      ],
    });
    await prisma.invoice.create({
      data: {
        workspaceId: owner.workspaceId,
        clientId,
        projectId,
        createdById: owner.userId,
        number: 'INV-P-1',
        issueDate: new Date('2026-02-10T00:00:00Z'),
        dueDate: new Date('2026-02-24T00:00:00Z'),
        status: 'SENT',
        subtotalMinor: 400_000n,
        totalMinor: 400_000n,
      },
    });

    const detail = await api(owner).get(`/projects/${projectId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.project.time).toEqual({
      loggedMinutes: 120,
      billableMinutes: 90,
      billableValueMinor: '90000',
    });
    expect(detail.body.project.billing).toMatchObject({
      invoicedMinor: '400000',
      invoiceCount: 1,
      budgetMinor: '1000000',
      budgetRemainingMinor: '600000',
    });
  });

  it('maintains completedAt when the status changes', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner);
    const created = await api(owner).post('/projects').send({ clientId, name: 'Lifecycle' });
    const projectId = created.body.project.id as string;

    const completed = await api(owner)
      .patch(`/projects/${projectId}`)
      .send({ status: 'COMPLETED' });
    expect(completed.status).toBe(200);
    expect(completed.body.project.completedAt).not.toBeNull();

    const reopened = await api(owner)
      .patch(`/projects/${projectId}`)
      .send({ status: 'IN_PROGRESS' });
    expect(reopened.body.project.completedAt).toBeNull();
  });

  it('blocks deletion once time is logged and deletes an unused project', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner);
    const used = await api(owner).post('/projects').send({ clientId, name: 'Used' });
    const usedId = used.body.project.id as string;
    await prisma.timeEntry.create({
      data: {
        workspaceId: owner.workspaceId,
        projectId: usedId,
        userId: owner.userId,
        minutes: 15,
        date: new Date(),
      },
    });

    const blocked = await api(owner).delete(`/projects/${usedId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Archive/);

    const unused = await api(owner).post('/projects').send({ clientId, name: 'Unused' });
    const unusedId = unused.body.project.id as string;
    expect((await api(owner).delete(`/projects/${unusedId}`)).status).toBe(204);
    expect(await prisma.project.count({ where: { id: unusedId } })).toBe(0);
  });

  it('enforces project permissions', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const employee = await registerUser();
    await prisma.workspaceMember.createMany({
      data: [
        {
          workspaceId: owner.workspaceId,
          userId: viewer.userId,
          role: 'VIEWER',
          acceptedAt: new Date(),
        },
        {
          workspaceId: owner.workspaceId,
          userId: employee.userId,
          role: 'EMPLOYEE',
          acceptedAt: new Date(),
        },
      ],
    });
    const clientId = await createClient(owner);

    const viewerRead = await api({ ...viewer, workspaceId: owner.workspaceId }).get('/projects');
    expect(viewerRead.status).toBe(200);

    const viewerWrite = await api({ ...viewer, workspaceId: owner.workspaceId })
      .post('/projects')
      .send({ clientId, name: 'Viewer project' });
    expect(viewerWrite.status).toBe(403);

    const employeeWrite = await api({ ...employee, workspaceId: owner.workspaceId })
      .post('/projects')
      .send({ clientId, name: 'Employee project' });
    expect(employeeWrite.status).toBe(201);

    const employeeDelete = await api({ ...employee, workspaceId: owner.workspaceId }).delete(
      `/projects/${employeeWrite.body.project.id as string}`,
    );
    expect(employeeDelete.status).toBe(403);
  });

  it('hides projects from users outside the workspace', async () => {
    const owner = await registerUser();
    const clientId = await createClient(owner);
    const created = await api(owner).post('/projects').send({ clientId, name: 'Private' });
    const projectId = created.body.project.id as string;

    const stranger = await registerUser();
    const response = await api(stranger).get(`/projects/${projectId}`);
    expect(response.status).toBe(404);

    const forced = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(forced.status).toBe(404);
  });
});
