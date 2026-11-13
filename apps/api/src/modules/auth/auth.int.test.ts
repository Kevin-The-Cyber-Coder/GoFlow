import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../app';
import { getPrisma } from '../../database/client';
import { resetDatabase } from '../../test-utils/db';

const app = createApp();
const prisma = getPrisma();

const CREDENTIALS = {
  email: 'Freelancer@Example.test',
  password: 'Str0ngPassword!',
  name: 'Test Freelancer',
};

async function registerUser(overrides: Partial<typeof CREDENTIALS> = {}) {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ ...CREDENTIALS, ...overrides });
}

describe('authentication', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers a user with a personal workspace', async () => {
    const response = await registerUser();

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'freelancer@example.test',
      name: 'Test Freelancer',
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.workspace.role).toBe('OWNER');
    expect(response.body.tokens.accessToken).toEqual(expect.any(String));
    expect(response.body.tokens.refreshToken).toEqual(expect.any(String));

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.workspaceMember.count({ where: { role: 'OWNER' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.registered' } })).toBe(1);
  });

  it('rejects duplicate e-mail addresses', async () => {
    await registerUser();
    const response = await registerUser();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects weak passwords during registration', async () => {
    const response = await registerUser({ password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body.error.details)).toMatch(/at least 10 characters/);
  });

  it('logs in with valid credentials and is case-insensitive on e-mail', async () => {
    await registerUser();
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'FREELANCER@example.test', password: CREDENTIALS.password });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(await prisma.auditLog.count({ where: { action: 'auth.login_succeeded' } })).toBe(1);
  });

  it('does not reveal whether the e-mail or the password was wrong', async () => {
    await registerUser();

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: 'Wr0ngPassword!' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'Wr0ngPassword!' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(await prisma.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(1);
  });

  it('returns the profile and workspace memberships for an access token', async () => {
    const registered = await registerUser();
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${registered.body.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('freelancer@example.test');
    expect(response.body.memberships).toHaveLength(1);
    expect(response.body.memberships[0]).toMatchObject({
      workspaceName: "Test Freelancer's workspace",
      role: 'OWNER',
    });
  });

  it('rejects requests without a valid access token', async () => {
    const missing = await request(app).get('/api/v1/auth/me');
    const malformed = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
  });

  it('rotates refresh tokens and detects replay of a used token', async () => {
    const registered = await registerUser();
    const original = registered.body.tokens.refreshToken as string;

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: original });
    expect(rotated.status).toBe(200);
    const next = rotated.body.refreshToken as string;
    expect(next).not.toBe(original);

    // Replaying the rotated-away token is treated as theft.
    const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: original });
    expect(replay.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } })).toBe(
      1,
    );

    // The whole family is revoked, including the token the thief never saw.
    const afterReplay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: next });
    expect(afterReplay.status).toBe(401);
  });

  it('signs out every device', async () => {
    const registered = await registerUser();
    const accessToken = registered.body.tokens.accessToken as string;
    const refreshToken = registered.body.tokens.refreshToken as string;

    const revoked = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedSessions).toBe(1);

    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('invalidates sessions after a password change', async () => {
    const registered = await registerUser();
    const accessToken = registered.body.tokens.accessToken as string;
    const refreshToken = registered.body.tokens.refreshToken as string;

    const changed = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: CREDENTIALS.password, newPassword: 'N3wStrongPassword!' });
    expect(changed.status).toBe(200);

    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: CREDENTIALS.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: 'N3wStrongPassword!' });
    expect(newLogin.status).toBe(200);
  });

  it('lists and revokes individual sessions', async () => {
    const registered = await registerUser();
    const accessToken = registered.body.tokens.accessToken as string;

    const listed = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.sessions).toHaveLength(1);

    const sessionId = listed.body.sessions[0].id as string;
    const revoked = await request(app)
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revoked.status).toBe(204);

    const again = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(again.body.sessions).toHaveLength(0);
  });
});
