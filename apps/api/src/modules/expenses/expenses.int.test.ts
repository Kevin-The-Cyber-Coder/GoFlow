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
  const email = `expense${counter}@example.test`;
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
    delete: (path: string) => auth(request(app).delete(`/api/v1${path}`)),
  };
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: 'VIEWER' | 'EMPLOYEE' | 'PROJECT_MANAGER' | 'ACCOUNTANT',
): Promise<void> {
  await prisma.workspaceMember.create({
    data: { workspaceId, userId, role, acceptedAt: new Date() },
  });
}

async function createCategory(session: Session, name: string): Promise<string> {
  const response = await api(session).post('/expenses/categories').send({ name });
  expect(response.status).toBe(201);
  return response.body.category.id as string;
}

async function createExpense(session: Session, overrides: Record<string, unknown> = {}) {
  return api(session)
    .post('/expenses')
    .send({
      description: 'Adobe subscription',
      amountMinor: '4599',
      date: '2026-03-02',
      vendor: 'Adobe',
      ...overrides,
    });
}

async function seedProject(session: Session): Promise<{ clientId: string; projectId: string }> {
  const client = await api(session).post('/clients').send({ name: 'Acme Studios' });
  expect(client.status).toBe(201);
  const clientId = client.body.client.id as string;

  const project = await api(session)
    .post('/projects')
    .send({ clientId, name: 'Website rebuild', startDate: '2026-03-01' });
  expect(project.status).toBe(201);

  return { clientId, projectId: project.body.project.id as string };
}

describe('expenses', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records an approved expense by default for a role that can approve', async () => {
    const owner = await registerUser();
    const categoryId = await createCategory(owner, 'Software');

    const response = await createExpense(owner, { categoryId });

    expect(response.status).toBe(201);
    expect(response.body.expense).toMatchObject({
      description: 'Adobe subscription',
      amountMinor: '4599',
      currency: 'USD',
      date: '2026-03-02',
      method: 'OTHER',
      vendor: 'Adobe',
      status: 'APPROVED',
      recurring: false,
      category: { id: categoryId, name: 'Software', color: '#64748b' },
      createdById: owner.userId,
    });

    const fetched = await api(owner).get(`/expenses/${response.body.expense.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.expense.id).toBe(response.body.expense.id);
  });

  it('submits an employee expense for review instead of approving it', async () => {
    const owner = await registerUser();
    const employee = await registerUser();
    const accountant = await registerUser();
    await addMember(owner.workspaceId, employee.userId, 'EMPLOYEE');
    await addMember(owner.workspaceId, accountant.userId, 'ACCOUNTANT');

    const employeeSession = { ...employee, workspaceId: owner.workspaceId };
    const accountantSession = { ...accountant, workspaceId: owner.workspaceId };

    const submitted = await createExpense(employeeSession);
    expect(submitted.status).toBe(201);
    expect(submitted.body.expense.status).toBe('SUBMITTED');

    const selfApproved = await createExpense(employeeSession, { status: 'APPROVED' });
    expect(selfApproved.status).toBe(403);

    const cannotReview = await api(employeeSession)
      .post(`/expenses/${submitted.body.expense.id}/review`)
      .send({ status: 'APPROVED' });
    expect(cannotReview.status).toBe(403);

    const approved = await api(accountantSession)
      .post(`/expenses/${submitted.body.expense.id}/review`)
      .send({ status: 'APPROVED', note: 'Receipt checked' });
    expect(approved.status).toBe(200);
    expect(approved.body.expense.status).toBe('APPROVED');

    const again = await api(accountantSession)
      .post(`/expenses/${submitted.body.expense.id}/review`)
      .send({ status: 'APPROVED' });
    expect(again.status).toBe(409);

    const trail = await api(owner).get(`/audit?entityId=${submitted.body.expense.id}`);
    expect(trail.body.entries.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining(['expense.approved', 'expense.created']),
    );
    const approval = trail.body.entries.find(
      (entry: { action: string }) => entry.action === 'expense.approved',
    );
    expect(approval.metadata).toMatchObject({ from: 'SUBMITTED', to: 'APPROVED' });
  });

  it('updates an expense and validates the linked records', async () => {
    const owner = await registerUser();
    const created = await createExpense(owner);
    const id = created.body.expense.id as string;

    const updated = await api(owner).patch(`/expenses/${id}`).send({
      amountMinor: '5000',
      date: '2026-03-03',
      notes: 'Corrected after the receipt arrived',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.expense).toMatchObject({
      amountMinor: '5000',
      date: '2026-03-03',
      notes: 'Corrected after the receipt arrived',
    });

    const trail = await api(owner).get(`/audit?entityId=${id}`);
    expect(trail.body.entries[0].action).toBe('expense.updated');

    expect((await api(owner).patch(`/expenses/${id}`).send({ amountMinor: '0' })).status).toBe(400);
    expect((await api(owner).patch(`/expenses/${id}`).send({ date: '2026-02-31' })).status).toBe(
      400,
    );
    expect((await api(owner).patch(`/expenses/${id}`).send({})).status).toBe(400);

    const unknownCategory = '00000000-0000-4000-8000-000000000000';
    expect(
      (await api(owner).patch(`/expenses/${id}`).send({ categoryId: unknownCategory })).status,
    ).toBe(404);

    const { clientId, projectId } = await seedProject(owner);
    const otherClient = await api(owner).post('/clients').send({ name: 'Other Client' });
    expect(otherClient.status).toBe(201);
    const stranger = await registerUser();
    const strangerProject = await seedProject(stranger);

    expect(
      (await api(owner).patch(`/expenses/${id}`).send({ projectId: strangerProject.projectId }))
        .status,
    ).toBe(404);

    const mismatch = await api(owner)
      .patch(`/expenses/${id}`)
      .send({ projectId, clientId: otherClient.body.client.id });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details[0].path).toBe('projectId');

    const linked = await api(owner).patch(`/expenses/${id}`).send({ projectId, clientId });
    expect(linked.status).toBe(200);
    expect(linked.body.expense).toMatchObject({ projectId, clientId });
  });

  it('filters and paginates the expense list', async () => {
    const owner = await registerUser();
    const software = await createCategory(owner, 'Software');
    const travel = await createCategory(owner, 'Travel');

    await createExpense(owner, { description: 'Adobe', vendor: 'Adobe', date: '2026-01-05' });
    await createExpense(owner, {
      description: 'Flight to Nairobi',
      vendor: 'Kenya Airways',
      date: '2026-02-10',
      categoryId: travel,
      amountMinor: '24000',
    });
    await createExpense(owner, {
      description: 'Figma',
      vendor: 'Figma Inc',
      date: '2026-03-01',
      categoryId: software,
    });

    const range = await api(owner).get('/expenses?from=2026-02-01&to=2026-02-10');
    expect(range.body.meta.total).toBe(1);
    expect(range.body.data[0].description).toBe('Flight to Nairobi');

    const byCategory = await api(owner).get(`/expenses?categoryId=${software}`);
    expect(byCategory.body.meta.total).toBe(1);
    expect(byCategory.body.data[0].description).toBe('Figma');

    const bySearch = await api(owner).get('/expenses?search=airways');
    expect(bySearch.body.meta.total).toBe(1);

    const byStatus = await api(owner).get('/expenses?status=APPROVED');
    expect(byStatus.body.meta.total).toBe(3);

    const impossible = await api(owner).get('/expenses?from=2026-02-31');
    expect(impossible.status).toBe(400);

    const first = await api(owner).get('/expenses?pageSize=2&page=1');
    expect(first.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(first.body.data).toHaveLength(2);

    const second = await api(owner).get('/expenses?pageSize=2&page=2');
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.hasNext).toBe(false);
  });

  it('only lets the recorder or an approver edit and delete', async () => {
    const owner = await registerUser();
    const employee = await registerUser();
    const colleague = await registerUser();
    await addMember(owner.workspaceId, employee.userId, 'EMPLOYEE');
    await addMember(owner.workspaceId, colleague.userId, 'EMPLOYEE');

    const employeeSession = { ...employee, workspaceId: owner.workspaceId };
    const colleagueSession = { ...colleague, workspaceId: owner.workspaceId };

    const created = await createExpense(employeeSession, { description: 'Taxi' });
    const id = created.body.expense.id as string;

    expect(
      (await api(colleagueSession).patch(`/expenses/${id}`).send({ notes: 'mine now' })).status,
    ).toBe(403);
    expect((await api(colleagueSession).delete(`/expenses/${id}`)).status).toBe(403);

    expect(
      (await api(employeeSession).patch(`/expenses/${id}`).send({ notes: 'Cab fare' })).status,
    ).toBe(200);

    expect((await api(owner).delete(`/expenses/${id}`)).status).toBe(204);
    expect((await api(owner).get(`/expenses/${id}`)).status).toBe(404);

    const trail = await api(owner).get(`/audit?entityId=${id}`);
    expect(trail.body.entries.map((entry: { action: string }) => entry.action)).toContain(
      'expense.deleted',
    );
  });

  it('rejects another workspace’s records and permissions', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const stranger = await registerUser();
    await addMember(owner.workspaceId, viewer.userId, 'VIEWER');

    const viewerSession = { ...viewer, workspaceId: owner.workspaceId };
    const created = await createExpense(owner);
    const id = created.body.expense.id as string;

    expect((await api(viewerSession).get('/expenses')).status).toBe(200);
    expect((await api(viewerSession).post('/expenses').send({})).status).toBe(403);
    expect((await api(viewerSession).patch(`/expenses/${id}`).send({ notes: 'x' })).status).toBe(
      403,
    );

    expect((await api(stranger).get(`/expenses/${id}`)).status).toBe(404);
    expect((await api(stranger).patch(`/expenses/${id}`).send({ notes: 'x' })).status).toBe(404);
    expect((await api(stranger).delete(`/expenses/${id}`)).status).toBe(404);

    const strangerList = await api(stranger).get('/expenses');
    expect(strangerList.body.meta.total).toBe(0);

    expect((await createExpense(stranger, { projectId: 'nope' })).status).toBe(400);
    const ownProject = await seedProject(owner);
    expect(
      (
        await api(stranger).post('/expenses').send({
          description: 'Smuggled',
          amountMinor: '100',
          date: '2026-03-01',
          projectId: ownProject.projectId,
        })
      ).status,
    ).toBe(404);

    expect(await prisma.expense.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
  });

  it('creates categorised expenses and rejects duplicates', async () => {
    const owner = await registerUser();

    const created = await api(owner)
      .post('/expenses/categories')
      .send({ name: 'Software', color: '#123ABC' });
    expect(created.status).toBe(201);
    expect(created.body.category).toMatchObject({ name: 'Software', color: '#123ABC' });

    const list = await api(owner).get('/expenses/categories');
    expect(list.status).toBe(200);
    expect(list.body.categories).toHaveLength(1);

    expect((await api(owner).post('/expenses/categories').send({ name: 'Software' })).status).toBe(
      409,
    );
    expect(
      (await api(owner).post('/expenses/categories').send({ name: 'Travel', color: 'blue' }))
        .status,
    ).toBe(400);

    const stranger = await registerUser();
    expect((await api(stranger).get('/expenses/categories')).body.categories).toEqual([]);
  });
});
