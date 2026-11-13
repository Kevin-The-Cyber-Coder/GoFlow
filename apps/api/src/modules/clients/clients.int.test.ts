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
  const email = `client${counter}@example.test`;
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

describe('client CRM', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a client and records an audit entry', async () => {
    const owner = await registerUser();
    const response = await api(owner)
      .post('/clients')
      .send({
        name: 'Acme Technologies',
        email: 'Billing@Acme.test',
        company: 'Acme Technologies Ltd',
        tags: ['retainer'],
        status: 'ACTIVE',
      });

    expect(response.status).toBe(201);
    expect(response.body.client).toMatchObject({
      name: 'Acme Technologies',
      email: 'billing@acme.test',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: 'client.created' },
    });
    expect(audit?.entityType).toBe('Client');
  });

  it('blocks duplicate clients by e-mail', async () => {
    const owner = await registerUser();
    await api(owner).post('/clients').send({ name: 'Acme', email: 'ops@acme.test' });

    const duplicate = await api(owner).post('/clients').send({
      name: 'Acme Holdings',
      email: 'ops@acme.test',
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_CLIENT');
    expect(duplicate.body.error.details.clientId).toEqual(expect.any(String));
  });

  it('blocks a duplicate name when no e-mail is supplied', async () => {
    const owner = await registerUser();
    await api(owner).post('/clients').send({ name: 'Northwind Design' });

    const duplicate = await api(owner).post('/clients').send({ name: 'northwind design' });
    expect(duplicate.status).toBe(409);
  });

  it('searches, filters and paginates clients', async () => {
    const owner = await registerUser();
    for (let index = 0; index < 7; index += 1) {
      await api(owner)
        .post('/clients')
        .send({
          name: `Client ${index}`,
          category: index % 2 === 0 ? 'Design' : 'Engineering',
        });
    }

    const page = await api(owner).get('/clients?page=2&pageSize=3&sort=name&order=asc');
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(3);
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 3, total: 7, totalPages: 3 });

    const search = await api(owner).get('/clients?search=client%205');
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe('Client 5');

    const filtered = await api(owner).get('/clients?category=Design');
    expect(filtered.body.meta.total).toBe(4);
  });

  it('rejects invalid pagination input', async () => {
    const owner = await registerUser();
    const response = await api(owner).get('/clients?page=0&pageSize=500');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("aggregates a client's financial history from invoices and payments", async () => {
    const owner = await registerUser();
    const created = await api(owner).post('/clients').send({ name: 'Ledger Client' });
    const clientId = created.body.client.id as string;

    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: owner.workspaceId,
        clientId,
        createdById: owner.userId,
        number: 'INV-0001',
        issueDate: new Date('2026-01-01T00:00:00Z'),
        dueDate: new Date('2026-01-15T00:00:00Z'),
        status: 'PARTIALLY_PAID',
        subtotalMinor: 100_000n,
        totalMinor: 100_000n,
      },
    });
    await prisma.payment.create({
      data: {
        workspaceId: owner.workspaceId,
        invoiceId: invoice.id,
        amountMinor: 40_000n,
        paidAt: new Date('2026-01-10T00:00:00Z'),
        recordedById: owner.userId,
        status: 'COMPLETED',
      },
    });

    const detail = await api(owner).get(`/clients/${clientId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.client.financials).toMatchObject({
      invoicedMinor: '100000',
      paidMinor: '40000',
      outstandingMinor: '60000',
      invoiceCount: 1,
    });
  });

  it('archives, hides and restores a client', async () => {
    const owner = await registerUser();
    const created = await api(owner).post('/clients').send({ name: 'Archive Me' });
    const clientId = created.body.client.id as string;

    expect((await api(owner).post(`/clients/${clientId}/archive`)).status).toBe(200);

    const hidden = await api(owner).get('/clients');
    expect(hidden.body.meta.total).toBe(0);

    const included = await api(owner).get('/clients?includeArchived=true');
    expect(included.body.meta.total).toBe(1);

    await api(owner).post(`/clients/${clientId}/restore`);
    const restored = await api(owner).get('/clients');
    expect(restored.body.meta.total).toBe(1);
  });

  it('refuses to edit an archived client', async () => {
    const owner = await registerUser();
    const created = await api(owner).post('/clients').send({ name: 'Locked' });
    const clientId = created.body.client.id as string;
    await api(owner).post(`/clients/${clientId}/archive`);

    const update = await api(owner).patch(`/clients/${clientId}`).send({ name: 'Changed' });
    expect(update.status).toBe(400);
  });

  it('blocks deletion when invoices exist, and soft-deletes otherwise', async () => {
    const owner = await registerUser();
    const created = await api(owner).post('/clients').send({ name: 'Historical' });
    const clientId = created.body.client.id as string;

    await prisma.invoice.create({
      data: {
        workspaceId: owner.workspaceId,
        clientId,
        createdById: owner.userId,
        number: 'INV-0002',
        issueDate: new Date(),
        dueDate: new Date(),
        subtotalMinor: 1_000n,
        totalMinor: 1_000n,
      },
    });

    const blocked = await api(owner).delete(`/clients/${clientId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Archive the client/);

    const other = await api(owner).post('/clients').send({ name: 'Disposable' });
    const otherId = other.body.client.id as string;
    expect((await api(owner).delete(`/clients/${otherId}`)).status).toBe(204);
    expect(await prisma.client.count({ where: { id: otherId, deletedAt: null } })).toBe(0);
  });

  it('keeps a single primary contact per client', async () => {
    const owner = await registerUser();
    const created = await api(owner).post('/clients').send({ name: 'Contacts Inc' });
    const clientId = created.body.client.id as string;

    const first = await api(owner)
      .post(`/clients/${clientId}/contacts`)
      .send({ name: 'Ada', isPrimary: true });
    expect(first.status).toBe(201);

    const second = await api(owner)
      .post(`/clients/${clientId}/contacts`)
      .send({ name: 'Grace', isPrimary: true });
    expect(second.status).toBe(201);

    const contacts = await api(owner).get(`/clients/${clientId}/contacts`);
    const primaries = (
      contacts.body.contacts as Array<{ isPrimary: boolean; name: string }>
    ).filter((contact) => contact.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.name).toBe('Grace');
  });

  it('does not let a viewer write client data', async () => {
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

    const viewerSession: Session = { ...viewer, workspaceId: owner.workspaceId };
    const read = await api(viewerSession).get('/clients');
    expect(read.status).toBe(200);

    const write = await api(viewerSession).post('/clients').send({ name: 'Nope' });
    expect(write.status).toBe(403);
  });

  it('hides clients from users outside the workspace', async () => {
    const owner = await registerUser();
    await api(owner).post('/clients').send({ name: 'Private Client' });

    const stranger = await registerUser();
    const response = await api(stranger).get('/clients?search=Private');
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(0);

    const forced = await request(app)
      .get('/api/v1/clients')
      .set('X-Workspace-Id', owner.workspaceId)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(forced.status).toBe(404);
  });
});
