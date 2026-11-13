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

async function registerUser(name = 'Owner'): Promise<Session> {
  counter += 1;
  const email = `member${counter}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassword!', name });

  expect(response.status).toBe(201);
  return {
    accessToken: response.body.tokens.accessToken as string,
    workspaceId: response.body.workspace.workspaceId as string,
    userId: response.body.user.id as string,
    email,
  };
}

function withWorkspace(session: Session, workspaceId = session.workspaceId) {
  return {
    get: (path: string) =>
      request(app)
        .get(`/api/v1/workspaces/${path}`)
        .set('X-Workspace-Id', workspaceId)
        .set('Authorization', `Bearer ${session.accessToken}`),
    patch: (path: string) =>
      request(app)
        .patch(`/api/v1/workspaces/${path}`)
        .set('X-Workspace-Id', workspaceId)
        .set('Authorization', `Bearer ${session.accessToken}`),
    post: (path: string) =>
      request(app)
        .post(`/api/v1/workspaces/${path}`)
        .set('X-Workspace-Id', workspaceId)
        .set('Authorization', `Bearer ${session.accessToken}`),
    delete: (path: string) =>
      request(app)
        .delete(`/api/v1/workspaces/${path}`)
        .set('X-Workspace-Id', workspaceId)
        .set('Authorization', `Bearer ${session.accessToken}`),
  };
}

async function invite(owner: Session, email: string, role: string): Promise<void> {
  const response = await withWorkspace(owner)
    .post(`${owner.workspaceId}/members`)
    .send({ email, role });
  expect(response.status).toBe(201);
}

describe('workspaces and role-based access control', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a workspace and lists it with the owner role', async () => {
    const owner = await registerUser();
    const response = await request(app)
      .get('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.workspaces).toHaveLength(1);
    expect(response.body.workspaces[0]).toMatchObject({ role: 'OWNER', memberCount: 1 });
  });

  it('hides workspaces the caller does not belong to', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();

    const response = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .set('Authorization', `Bearer ${stranger.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.auditLog.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
  });

  it('lets an owner update settings and records an audit entry', async () => {
    const owner = await registerUser();
    const response = await withWorkspace(owner)
      .patch(owner.workspaceId)
      .send({ name: 'Studio Renamed', currency: 'EUR', defaultTaxRateBps: 2000 });

    expect(response.status).toBe(200);
    expect(response.body.workspace).toMatchObject({ name: 'Studio Renamed', currency: 'EUR' });

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: 'workspace.updated' },
    });
    expect(audit?.metadata).toEqual({ fields: ['name', 'currency', 'defaultTaxRateBps'] });
  });

  it('rejects invalid settings such as a 150% tax rate', async () => {
    const owner = await registerUser();
    const response = await withWorkspace(owner)
      .patch(owner.workspaceId)
      .send({ defaultTaxRateBps: 15_000 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invites an existing account and enforces its role', async () => {
    const owner = await registerUser();
    const accountant = await registerUser('Accountant');

    await invite(owner, accountant.email, 'ACCOUNTANT');

    const members = await withWorkspace(owner).get(`${owner.workspaceId}/members`);
    expect(members.status).toBe(200);
    expect(members.body.members).toHaveLength(2);

    const allowed = await withWorkspace(accountant, owner.workspaceId).get(owner.workspaceId);
    expect(allowed.status).toBe(200);

    const denied = await withWorkspace(accountant, owner.workspaceId)
      .patch(owner.workspaceId)
      .send({ name: 'Hijacked' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses to invite unknown accounts or existing members', async () => {
    const owner = await registerUser();
    const member = await registerUser('Existing');

    const unknown = await withWorkspace(owner)
      .post(`${owner.workspaceId}/members`)
      .send({ email: 'ghost@example.test', role: 'VIEWER' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('INVITEE_NOT_FOUND');

    await invite(owner, member.email, 'VIEWER');
    const duplicate = await withWorkspace(owner)
      .post(`${owner.workspaceId}/members`)
      .send({ email: member.email, role: 'VIEWER' });
    expect(duplicate.status).toBe(409);
  });

  it('does not allow assigning OWNER through an invitation or role change', async () => {
    const owner = await registerUser();
    const member = await registerUser('Member');

    const inviteAsOwner = await withWorkspace(owner)
      .post(`${owner.workspaceId}/members`)
      .send({ email: member.email, role: 'OWNER' });
    expect(inviteAsOwner.status).toBe(400);

    await invite(owner, member.email, 'VIEWER');
    const memberRecord = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, userId: member.userId },
    });

    const promote = await withWorkspace(owner)
      .patch(`${owner.workspaceId}/members/${memberRecord.id}`)
      .send({ role: 'OWNER' });
    expect(promote.status).toBe(400);
  });

  it('promotes a member to admin, who can then manage settings', async () => {
    const owner = await registerUser();
    const member = await registerUser('Promoted');
    await invite(owner, member.email, 'VIEWER');

    const record = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, userId: member.userId },
    });

    const promoted = await withWorkspace(owner)
      .patch(`${owner.workspaceId}/members/${record.id}`)
      .send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);

    const canUpdate = await withWorkspace(member, owner.workspaceId)
      .patch(owner.workspaceId)
      .send({ invoicePrefix: 'GF' });
    expect(canUpdate.status).toBe(200);

    // Admins still cannot transfer ownership.
    const transfer = await withWorkspace(member, owner.workspaceId)
      .post(`${owner.workspaceId}/transfer-ownership`)
      .send({ userId: member.userId });
    expect(transfer.status).toBe(403);
  });

  it('removes a member and revokes their access immediately', async () => {
    const owner = await registerUser();
    const member = await registerUser('Removed');
    await invite(owner, member.email, 'EMPLOYEE');

    const record = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, userId: member.userId },
    });

    const removed = await withWorkspace(owner).delete(`${owner.workspaceId}/members/${record.id}`);
    expect(removed.status).toBe(204);

    const denied = await withWorkspace(member, owner.workspaceId).get(owner.workspaceId);
    expect(denied.status).toBe(404);
  });

  it('prevents removing or demoting the owner', async () => {
    const owner = await registerUser();
    const ownerRecord = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, role: 'OWNER' },
    });

    const removal = await withWorkspace(owner).delete(
      `${owner.workspaceId}/members/${ownerRecord.id}`,
    );
    expect(removal.status).toBe(400);

    const demotion = await withWorkspace(owner)
      .patch(`${owner.workspaceId}/members/${ownerRecord.id}`)
      .send({ role: 'VIEWER' });
    expect(demotion.status).toBe(400);
  });

  it('transfers ownership atomically and demotes the previous owner to admin', async () => {
    const owner = await registerUser();
    const successor = await registerUser('Successor');
    await invite(owner, successor.email, 'ADMIN');

    const transfer = await withWorkspace(owner)
      .post(`${owner.workspaceId}/transfer-ownership`)
      .send({ userId: successor.userId });
    expect(transfer.status).toBe(200);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: owner.workspaceId },
    });
    expect(workspace.ownerId).toBe(successor.userId);

    const roles = await prisma.workspaceMember.findMany({
      where: { workspaceId: owner.workspaceId },
      select: { userId: true, role: true },
    });
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: successor.userId, role: 'OWNER' },
        { userId: owner.userId, role: 'ADMIN' },
      ]),
    );

    // The previous owner is no longer allowed to transfer again.
    const again = await withWorkspace(owner, owner.workspaceId)
      .post(`${owner.workspaceId}/transfer-ownership`)
      .send({ userId: owner.userId });
    expect(again.status).toBe(403);
  });

  it('exposes the permission matrix to authenticated users', async () => {
    const owner = await registerUser();
    const response = await request(app)
      .get('/api/v1/workspaces/roles')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.roles).toHaveLength(6);
  });
});
