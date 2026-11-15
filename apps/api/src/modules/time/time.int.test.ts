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
  const email = `time${counter}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassword!', name: `Timer ${counter}` });
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

async function seed(session: Session): Promise<{ projectId: string; taskId: string }> {
  const client = await api(session).post('/clients').send({ name: 'Time Client' });
  const project = await api(session)
    .post('/projects')
    .send({ clientId: client.body.client.id as string, name: 'Time Project' });
  const projectId = project.body.project.id as string;
  const task = await api(session).post(`/projects/${projectId}/tasks`).send({ title: 'Build' });
  return { projectId, taskId: task.body.task.id as string };
}

describe('time tracking', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('logs an entry, inherits the previous hourly rate and audits it', async () => {
    const owner = await registerUser();
    const { projectId, taskId } = await seed(owner);

    const first = await api(owner).post('/time/entries').send({
      projectId,
      taskId,
      minutes: 90,
      date: '2026-03-02',
      hourlyRateMinor: '60000',
      note: 'Discovery',
    });
    expect(first.status).toBe(201);
    expect(first.body.entry).toMatchObject({
      minutes: 90,
      billable: true,
      hourlyRateMinor: '60000',
      valueMinor: '90000',
      date: '2026-03-02',
      note: 'Discovery',
    });
    expect(first.body.entry.project).toMatchObject({ id: projectId, name: 'Time Project' });
    expect(first.body.entry.task).toMatchObject({ id: taskId, title: 'Build' });

    const second = await api(owner)
      .post('/time/entries')
      .send({ projectId, minutes: 30, date: '2026-03-03' });
    expect(second.body.entry.hourlyRateMinor).toBe('60000');
    expect(second.body.entry.valueMinor).toBe('30000');

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: 'time.created' },
    });
    expect(audit?.entityType).toBe('TimeEntry');
  });

  it('keeps non-billable time at no rate and no value', async () => {
    const owner = await registerUser();
    const { projectId } = await seed(owner);

    const response = await api(owner).post('/time/entries').send({
      projectId,
      minutes: 45,
      date: '2026-03-04',
      billable: false,
      hourlyRateMinor: '50000',
    });

    expect(response.status).toBe(201);
    expect(response.body.entry.hourlyRateMinor).toBeNull();
    expect(response.body.entry.valueMinor).toBe('0');
  });

  it('validates minutes, dates, projects and tasks', async () => {
    const owner = await registerUser();
    const { projectId } = await seed(owner);
    const other = await registerUser();
    const foreign = await seed(other);

    const cases = [
      { projectId, minutes: 0, date: '2026-03-01' },
      { projectId, minutes: 1_441, date: '2026-03-01' },
      { projectId, minutes: 30, date: '2026-02-30' },
      { projectId: foreign.projectId, minutes: 30, date: '2026-03-01' },
      { projectId, taskId: foreign.taskId, minutes: 30, date: '2026-03-01' },
    ];

    for (const body of cases) {
      const response = await api(owner).post('/time/entries').send(body);
      expect([400, 404]).toContain(response.status);
    }
  });

  it('filters entries and limits employees to their own time', async () => {
    const owner = await registerUser();
    const employee = await registerUser();
    await prisma.workspaceMember.create({
      data: {
        workspaceId: owner.workspaceId,
        userId: employee.userId,
        role: 'EMPLOYEE',
        acceptedAt: new Date(),
      },
    });
    const ownerSession = { ...owner };
    const employeeSession = { ...employee, workspaceId: owner.workspaceId };

    const { projectId } = await seed(owner);
    await api(ownerSession)
      .post('/time/entries')
      .send({ projectId, minutes: 60, date: '2026-03-05', hourlyRateMinor: '60000' });
    await api(employeeSession)
      .post('/time/entries')
      .send({ projectId, minutes: 120, date: '2026-03-06', hourlyRateMinor: '40000' });

    const ownerView = await api(ownerSession).get('/time/entries');
    expect(ownerView.body.meta.total).toBe(2);

    const employeeView = await api(employeeSession).get('/time/entries');
    expect(employeeView.body.meta.total).toBe(1);
    expect(employeeView.body.data[0].user.id).toBe(employee.userId);

    const forced = await api(employeeSession).get(`/time/entries?userId=${owner.userId}`);
    expect(forced.body.meta.total).toBe(1);

    const byDate = await api(ownerSession).get('/time/entries?from=2026-03-06&to=2026-03-06');
    expect(byDate.body.meta.total).toBe(1);

    const billable = await api(ownerSession).get('/time/entries?billable=true');
    expect(billable.body.meta.total).toBe(2);

    const paged = await api(ownerSession).get('/time/entries?pageSize=1&page=2');
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta.totalPages).toBe(2);
  });

  it("stops an employee editing a colleague's entry but lets a manager do it", async () => {
    const owner = await registerUser();
    const employee = await registerUser();
    const manager = await registerUser();
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
          userId: manager.userId,
          role: 'PROJECT_MANAGER',
          acceptedAt: new Date(),
        },
      ],
    });
    const employeeSession = { ...employee, workspaceId: owner.workspaceId };
    const managerSession = { ...manager, workspaceId: owner.workspaceId };

    const { projectId } = await seed(owner);
    const created = await api(owner)
      .post('/time/entries')
      .send({ projectId, minutes: 30, date: '2026-03-07' });
    const entryId = created.body.entry.id as string;

    const denied = await api(employeeSession)
      .patch(`/time/entries/${entryId}`)
      .send({ minutes: 45 });
    expect(denied.status).toBe(404);

    const allowed = await api(managerSession)
      .patch(`/time/entries/${entryId}`)
      .send({ minutes: 45, note: 'Adjusted by PM' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.entry.minutes).toBe(45);

    const deleted = await api(managerSession).delete(`/time/entries/${entryId}`);
    expect(deleted.status).toBe(204);
  });

  it('clearing billable removes the rate and moving project clears the task', async () => {
    const owner = await registerUser();
    const { projectId, taskId } = await seed(owner);
    const other = await api(owner)
      .post('/projects')
      .send({
        clientId: (await api(owner).post('/clients').send({ name: 'Other Client' })).body.client
          .id as string,
        name: 'Other Project',
      });

    const created = await api(owner)
      .post('/time/entries')
      .send({ projectId, taskId, minutes: 60, date: '2026-03-08', hourlyRateMinor: '60000' });
    const entryId = created.body.entry.id as string;

    const nonBillable = await api(owner)
      .patch(`/time/entries/${entryId}`)
      .send({ billable: false });
    expect(nonBillable.body.entry.hourlyRateMinor).toBeNull();

    const moved = await api(owner)
      .patch(`/time/entries/${entryId}`)
      .send({ projectId: other.body.project.id as string });
    expect(moved.status).toBe(200);
    expect(moved.body.entry.project.id).toBe(other.body.project.id);
    expect(moved.body.entry.task).toBeNull();
  });

  it('summarises a period by user, project and day', async () => {
    const owner = await registerUser();
    const employee = await registerUser();
    await prisma.workspaceMember.create({
      data: {
        workspaceId: owner.workspaceId,
        userId: employee.userId,
        role: 'EMPLOYEE',
        acceptedAt: new Date(),
      },
    });
    const employeeSession = { ...employee, workspaceId: owner.workspaceId };
    const { projectId } = await seed(owner);

    await api(owner)
      .post('/time/entries')
      .send({ projectId, minutes: 60, date: '2026-03-09', hourlyRateMinor: '60000' });
    await api(employeeSession)
      .post('/time/entries')
      .send({ projectId, minutes: 30, date: '2026-03-09', hourlyRateMinor: '30000' });

    const summary = await api(owner).get('/time/summary?from=2026-03-01&to=2026-03-31');
    expect(summary.status).toBe(200);
    expect(summary.body.totals).toEqual({
      entries: 2,
      minutes: 90,
      billableMinutes: 90,
      billableValueMinor: '75000',
    });
    expect(summary.body.byUser).toHaveLength(2);
    expect(summary.body.byProject).toEqual([
      {
        projectId,
        name: 'Time Project',
        minutes: 90,
        billableMinutes: 90,
        billableValueMinor: '75000',
      },
    ]);
    expect(summary.body.byDay).toEqual([{ date: '2026-03-09', minutes: 90, billableMinutes: 90 }]);

    const employeeSummary = await api(employeeSession).get(
      '/time/summary?from=2026-03-01&to=2026-03-31',
    );
    expect(employeeSummary.body.totals.minutes).toBe(30);
  });

  it('rejects an inverted or oversized summary range', async () => {
    const owner = await registerUser();
    expect((await api(owner).get('/time/summary?from=2026-03-31&to=2026-03-01')).status).toBe(400);
    expect((await api(owner).get('/time/summary?from=2024-01-01&to=2026-01-01')).status).toBe(400);
  });

  it('lets viewers read but not log time', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    await prisma.workspaceMember.create({
      data: {
        workspaceId: owner.workspaceId,
        userId: viewer.userId,
        role: 'VIEWER',
        acceptedAt: new Date(),
      },
    });
    const viewerSession = { ...viewer, workspaceId: owner.workspaceId };
    const { projectId } = await seed(owner);

    expect((await api(viewerSession).get('/time/entries')).status).toBe(200);
    expect(
      (
        await api(viewerSession)
          .post('/time/entries')
          .send({ projectId, minutes: 30, date: '2026-03-10' })
      ).status,
    ).toBe(403);
  });
});
