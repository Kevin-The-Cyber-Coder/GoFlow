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
}

let counter = 0;

async function registerUser(): Promise<Session> {
  counter += 1;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `task${counter}@example.test`,
      password: 'Str0ngPassword!',
      name: `Task ${counter}`,
    });
  expect(response.status).toBe(201);
  return {
    accessToken: response.body.tokens.accessToken as string,
    workspaceId: response.body.workspace.workspaceId as string,
    userId: response.body.user.id as string,
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

async function seedProject(session: Session): Promise<{ projectId: string; clientId: string }> {
  const client = await api(session).post('/clients').send({ name: 'Task Client' });
  const clientId = client.body.client.id as string;
  const project = await api(session).post('/projects').send({ clientId, name: 'Task Project' });
  return { projectId: project.body.project.id as string, clientId };
}

describe('project tasks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates tasks at the bottom of their column and audits them', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);

    const first = await api(owner).post(`/projects/${projectId}/tasks`).send({ title: 'Spec' });
    const second = await api(owner).post(`/projects/${projectId}/tasks`).send({ title: 'Design' });
    const blocked = await api(owner)
      .post(`/projects/${projectId}/tasks`)
      .send({ title: 'Copy', status: 'BLOCKED', dueDate: '2026-04-01', estimateMinutes: 120 });

    expect(first.status).toBe(201);
    expect(first.body.task).toMatchObject({ title: 'Spec', status: 'TODO', position: 0 });
    expect(second.body.task.position).toBe(1);
    expect(blocked.body.task).toMatchObject({
      status: 'BLOCKED',
      dueDate: '2026-04-01',
      estimateMinutes: 120,
      completedAt: null,
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        workspaceId: owner.workspaceId,
        action: 'task.created',
        entityId: second.body.task.id as string,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('creates a task directly in DONE with a completion timestamp', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);
    const response = await api(owner)
      .post(`/projects/${projectId}/tasks`)
      .send({ title: 'Already done', status: 'DONE' });
    expect(response.body.task.completedAt).not.toBeNull();
  });

  it('filters, searches and summarises the board', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);
    for (const [title, status] of [
      ['Write copy', 'TODO'],
      ['Design hero', 'IN_PROGRESS'],
      ['Build hero', 'IN_PROGRESS'],
      ['Ship it', 'DONE'],
    ] as const) {
      await api(owner).post(`/projects/${projectId}/tasks`).send({ title, status });
    }

    const all = await api(owner).get(`/projects/${projectId}/tasks`);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(4);
    expect(all.body.summary).toEqual({ TODO: 1, IN_PROGRESS: 2, BLOCKED: 0, DONE: 1 });

    const inProgress = await api(owner).get(`/projects/${projectId}/tasks?status=IN_PROGRESS`);
    expect(inProgress.body.data).toHaveLength(2);
    expect(inProgress.body.data.map((task: { title: string }) => task.title)).toEqual([
      'Design hero',
      'Build hero',
    ]);

    const searched = await api(owner).get(`/projects/${projectId}/tasks?search=hero`);
    expect(searched.body.data).toHaveLength(2);
  });

  it('moves a task to another column and maintains completedAt', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);
    const task = await api(owner).post(`/projects/${projectId}/tasks`).send({ title: 'Finish me' });
    const taskId = task.body.task.id as string;

    const done = await api(owner)
      .patch(`/projects/${projectId}/tasks/${taskId}`)
      .send({ status: 'DONE' });
    expect(done.status).toBe(200);
    expect(done.body.task.completedAt).not.toBeNull();

    const reopened = await api(owner)
      .patch(`/projects/${projectId}/tasks/${taskId}`)
      .send({ status: 'TODO' });
    expect(reopened.body.task.completedAt).toBeNull();
  });

  it('reorders a column atomically and rejects invalid id lists', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C']) {
      const created = await api(owner).post(`/projects/${projectId}/tasks`).send({ title });
      ids.push(created.body.task.id as string);
    }

    const reordered = await api(owner)
      .post(`/projects/${projectId}/tasks/reorder`)
      .send({ status: 'TODO', orderedIds: [ids[2], ids[0], ids[1]] });

    expect(reordered.status).toBe(200);
    const positions = (reordered.body.data as Array<{ id: string; position: number }>).map(
      (task) => [task.id, task.position],
    );
    expect(positions).toEqual([
      [ids[2], 0],
      [ids[0], 1],
      [ids[1], 2],
    ]);

    const duplicate = await api(owner)
      .post(`/projects/${projectId}/tasks/reorder`)
      .send({ status: 'TODO', orderedIds: [ids[0], ids[0]] });
    expect(duplicate.status).toBe(400);

    const other = await registerUser();
    const foreign = await seedProject(other);
    const foreignTask = await api(other)
      .post(`/projects/${foreign.projectId}/tasks`)
      .send({ title: 'X' });
    const mixed = await api(owner)
      .post(`/projects/${projectId}/tasks/reorder`)
      .send({ status: 'TODO', orderedIds: [ids[0], foreignTask.body.task.id] });
    expect(mixed.status).toBe(400);
  });

  it('deletes a task without destroying logged time', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);
    const created = await api(owner)
      .post(`/projects/${projectId}/tasks`)
      .send({ title: 'Temporary' });
    const taskId = created.body.task.id as string;
    const entry = await prisma.timeEntry.create({
      data: {
        workspaceId: owner.workspaceId,
        projectId,
        taskId,
        userId: owner.userId,
        minutes: 30,
        date: new Date(),
      },
    });

    expect((await api(owner).delete(`/projects/${projectId}/tasks/${taskId}`)).status).toBe(204);
    const survived = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(survived.taskId).toBeNull();
  });

  it('validates task input', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);

    expect((await api(owner).post(`/projects/${projectId}/tasks`).send({ title: '' })).status).toBe(
      400,
    );
    expect(
      (
        await api(owner)
          .post(`/projects/${projectId}/tasks`)
          .send({ title: 'X', estimateMinutes: 0 })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(owner)
          .post(`/projects/${projectId}/tasks`)
          .send({ title: 'X', dueDate: '2026-13-01' })
      ).status,
    ).toBe(400);
    expect((await api(owner).patch(`/projects/${projectId}/tasks/missing`).send({})).status).toBe(
      400,
    );
  });

  it('isolates tasks by project, workspace and role', async () => {
    const owner = await registerUser();
    const { projectId } = await seedProject(owner);
    const created = await api(owner)
      .post(`/projects/${projectId}/tasks`)
      .send({ title: 'Private' });
    const taskId = created.body.task.id as string;

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

    expect((await api(viewerSession).get(`/projects/${projectId}/tasks`)).status).toBe(200);
    expect(
      (
        await api(viewerSession)
          .patch(`/projects/${projectId}/tasks/${taskId}`)
          .send({ title: 'No' })
      ).status,
    ).toBe(403);

    const stranger = await registerUser();
    expect((await api(stranger).get(`/projects/${projectId}/tasks`)).status).toBe(404);
  });
});
