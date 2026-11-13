import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../app';
import { getPrisma } from '../../database/client';
import { resetDatabase } from '../../test-utils/db';

const app = createApp();
const prisma = getPrisma();

interface Session {
  accessToken: string;
  refreshToken: string;
  workspaceId: string;
  userId: string;
  email: string;
}

let counter = 0;

async function registerUser(): Promise<Session> {
  counter += 1;
  const email = `profile${counter}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassword!', name: `Profile ${counter}` });
  expect(response.status).toBe(201);
  return {
    accessToken: response.body.tokens.accessToken as string,
    refreshToken: response.body.tokens.refreshToken as string,
    workspaceId: response.body.workspace.workspaceId as string,
    userId: response.body.user.id as string,
    email,
  };
}

function api(session: Session) {
  return {
    patch: (path: string) =>
      request(app).patch(`/api/v1${path}`).set('Authorization', `Bearer ${session.accessToken}`),
    delete: (path: string) =>
      request(app).delete(`/api/v1${path}`).set('Authorization', `Bearer ${session.accessToken}`),
    get: (path: string) =>
      request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${session.accessToken}`),
    post: (path: string) =>
      request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${session.accessToken}`),
  };
}

describe('user profile', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('updates profile preferences and returns the fresh profile', async () => {
    const session = await registerUser();

    const response = await api(session).patch('/users/me').send({
      name: '  Ada Lovelace  ',
      locale: 'en-GB',
      timezone: 'Africa/Johannesburg',
      currency: 'zar',
      avatarUrl: 'https://cdn.example.test/ada.png',
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      name: 'Ada Lovelace',
      locale: 'en-GB',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      avatarUrl: 'https://cdn.example.test/ada.png',
    });
    expect(response.body.memberships).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: session.userId, action: 'user.profile_updated' },
    });
    expect(audit?.metadata).toMatchObject({
      fields: expect.arrayContaining(['name', 'locale', 'timezone', 'currency', 'avatarUrl']),
    });
  });

  it('lets the user clear the avatar', async () => {
    const session = await registerUser();
    const response = await api(session).patch('/users/me').send({ avatarUrl: null });
    expect(response.status).toBe(200);
    expect(response.body.user.avatarUrl).toBeNull();
  });

  it('rejects unknown preferences', async () => {
    const session = await registerUser();
    const response = await api(session)
      .patch('/users/me')
      .send({ timezone: 'Mars/Olympus', currency: 'ZZZ', locale: 'not a locale!!' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const paths = (response.body.error.details as Array<{ path: string }>).map(
      (detail) => detail.path,
    );
    expect(paths).toEqual(expect.arrayContaining(['timezone', 'currency', 'locale']));
  });

  it('refuses to change e-mail, status or other privileged fields', async () => {
    const session = await registerUser();
    const response = await api(session)
      .patch('/users/me')
      .send({ email: 'attacker@example.test', status: 'DISABLED' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toMatch(/unrecognized|Unrecognized/u);
  });

  it('rejects an empty profile update', async () => {
    const session = await registerUser();
    const response = await api(session).patch('/users/me').send({});
    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app).patch('/api/v1/users/me').send({ name: 'Nobody' });
    expect(response.status).toBe(401);
  });

  it('closes the account, revokes sessions and blocks future logins', async () => {
    const session = await registerUser();

    const closed = await api(session).delete('/users/me').send({ password: 'Str0ngPassword!' });
    expect(closed.status).toBe(204);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: 'Str0ngPassword!' });
    expect(login.status).toBe(401);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);

    const profile = await api(session).get('/auth/me');
    expect(profile.status).toBe(401);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.status).toBe('DISABLED');

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: session.userId, action: 'user.account_closed' },
    });
    expect(audit).not.toBeNull();
  });

  it('does not close the account without the correct password', async () => {
    const session = await registerUser();
    const response = await api(session).delete('/users/me').send({ password: 'WrongPassword1' });

    expect(response.status).toBe(400);
    expect(await prisma.user.count({ where: { id: session.userId, deletedAt: null } })).toBe(1);

    expect((await api(session).get('/auth/me')).status).toBe(200);
  });

  it('blocks a sole owner from abandoning a shared workspace', async () => {
    const owner = await registerUser();
    const teammate = await registerUser();

    const invited = await api(owner)
      .post(`/workspaces/${owner.workspaceId}/members`)
      .send({ email: teammate.email, role: 'EMPLOYEE' });
    expect(invited.status).toBe(201);

    const blocked = await api(owner).delete('/users/me').send({ password: 'Str0ngPassword!' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Transfer ownership/);
    expect(blocked.body.error.details.workspaceId).toBe(owner.workspaceId);

    expect(
      await prisma.workspace.count({ where: { id: owner.workspaceId, deletedAt: null } }),
    ).toBe(1);
    expect(await prisma.user.count({ where: { id: owner.userId, deletedAt: null } })).toBe(1);
  });

  it('allows a sole owner to close their own private workspace account', async () => {
    const session = await registerUser();
    const response = await api(session).delete('/users/me').send({ password: 'Str0ngPassword!' });
    expect(response.status).toBe(204);
  });
});
