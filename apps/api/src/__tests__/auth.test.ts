import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createTestContext, readCookie, resetDatabase, type TestContext } from './helpers/test-app';

const VALID_REGISTRATION = {
  email: 'Kevin@Example.com',
  password: 'correct-horse-battery-staple',
  name: 'Kevin',
};

describe('authentication', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await resetDatabase(context.db);
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates a user, a workspace and a session', async () => {
      const response = await request(context.app)
        .post('/api/v1/auth/register')
        .send(VALID_REGISTRATION);

      expect(response.status).toBe(201);
      expect(response.body.data.user).toMatchObject({
        email: 'kevin@example.com',
        name: 'Kevin',
      });
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
      expect(response.body.data.workspace).toMatchObject({ name: "Kevin's workspace" });
      expect(typeof response.body.data.accessToken).toBe('string');

      const refreshCookie = readCookie(response.headers['set-cookie'], 'goflow_refresh');
      expect(refreshCookie).toBeDefined();
      expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    });

    it('rejects a duplicate email regardless of casing', async () => {
      await request(context.app).post('/api/v1/auth/register').send(VALID_REGISTRATION);

      const response = await request(context.app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_REGISTRATION, email: 'KEVIN@example.com' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('rejects a short password with field-level details', async () => {
      const response = await request(context.app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_REGISTRATION, password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'password' })]),
      );
    });

    it('rejects unknown fields instead of silently ignoring them', async () => {
      const response = await request(context.app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_REGISTRATION, role: 'admin' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns a session for valid credentials', async () => {
      await request(context.app).post('/api/v1/auth/register').send(VALID_REGISTRATION);

      const response = await request(context.app)
        .post('/api/v1/auth/login')
        .send({ email: 'kevin@example.com', password: VALID_REGISTRATION.password });

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe('kevin@example.com');
    });

    it('uses one generic error for a wrong password', async () => {
      await request(context.app).post('/api/v1/auth/register').send(VALID_REGISTRATION);

      const response = await request(context.app)
        .post('/api/v1/auth/login')
        .send({ email: 'kevin@example.com', password: 'not-the-password' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(response.body.error.message).toBe('Invalid email or password.');
    });

    it('returns the same error for an unknown account', async () => {
      const response = await request(context.app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever-password' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates the refresh token', async () => {
      const agent = request.agent(context.app);
      const registration = await agent.post('/api/v1/auth/register').send(VALID_REGISTRATION);
      const firstCookie = readCookie(registration.headers['set-cookie'], 'goflow_refresh');

      const firstRefresh = await agent.post('/api/v1/auth/refresh');
      expect(firstRefresh.status).toBe(200);

      const secondCookie = readCookie(firstRefresh.headers['set-cookie'], 'goflow_refresh');
      expect(secondCookie).toBeDefined();
      expect(secondCookie).not.toBe(firstCookie);
    });

    it('revokes the whole family when a used token is replayed', async () => {
      const agent = request.agent(context.app);
      const registration = await agent.post('/api/v1/auth/register').send(VALID_REGISTRATION);
      const firstCookie = readCookie(registration.headers['set-cookie'], 'goflow_refresh');

      const rotation = await agent.post('/api/v1/auth/refresh');
      const secondCookie = readCookie(rotation.headers['set-cookie'], 'goflow_refresh');

      const replay = await request(context.app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `goflow_refresh=${firstCookie}`);

      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('SESSION_REVOKED');

      const afterReplay = await request(context.app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `goflow_refresh=${secondCookie}`);

      expect(afterReplay.status).toBe(401);
    });

    it('rejects a request without a refresh cookie', async () => {
      const response = await request(context.app).post('/api/v1/auth/refresh');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_REFRESH_TOKEN');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const agent = request.agent(context.app);
      const registration = await agent.post('/api/v1/auth/register').send(VALID_REGISTRATION);
      const cookie = readCookie(registration.headers['set-cookie'], 'goflow_refresh');

      const logout = await agent.post('/api/v1/auth/logout');
      expect(logout.status).toBe(204);

      const refresh = await request(context.app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `goflow_refresh=${cookie}`);

      expect(refresh.status).toBe(401);
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('returns the profile for a valid access token', async () => {
      const registration = await request(context.app)
        .post('/api/v1/auth/register')
        .send(VALID_REGISTRATION);

      const response = await request(context.app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${registration.body.data.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe('kevin@example.com');
      expect(response.body.data.workspaces).toHaveLength(1);
    });

    it('rejects a request without a token', async () => {
      const response = await request(context.app).get('/api/v1/users/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('rejects a tampered token', async () => {
      const response = await request(context.app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not.a.real.token');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });
});
