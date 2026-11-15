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
  const email = `invoice${counter}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPassword!', name: `Biller ${counter}` });
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

interface DraftBody {
  clientId?: string;
  projectId?: string;
  issueDate?: string;
  dueDate?: string;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

async function seedClient(session: Session, name = 'Acme Studios') {
  const response = await api(session).post('/clients').send({ name });
  expect(response.status).toBe(201);
  return response.body.client.id as string;
}

const DESIGN_ITEM = {
  description: 'Design',
  quantityMilli: 1_500,
  unitPriceMinor: '8000',
  taxRateBps: 2_000,
};

const DEFAULT_ITEMS = [
  DESIGN_ITEM,
  {
    description: 'Hosting',
    quantityMilli: 1_000,
    unitPriceMinor: '2500',
    discountMinor: '500',
    taxRateBps: 2_000,
  },
];

function draftBody(clientId: string, overrides: DraftBody = {}): DraftBody {
  return {
    clientId,
    issueDate: '2026-03-01',
    dueDate: '2026-03-31',
    items: DEFAULT_ITEMS,
    ...overrides,
  };
}

async function createDraft(session: Session, overrides: DraftBody = {}) {
  const clientId = overrides.clientId ?? (await seedClient(session));
  const response = await api(session).post('/invoices').send(draftBody(clientId, overrides));
  return response;
}

describe('invoices', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a draft with computed totals, the first number and an audit row', async () => {
    const owner = await registerUser();
    const response = await createDraft(owner);

    expect(response.status).toBe(201);
    const invoice = response.body.invoice;
    expect(invoice).toMatchObject({
      number: 'INV-0001',
      status: 'DRAFT',
      isOverdue: false,
      currency: 'USD',
      issueDate: '2026-03-01',
      dueDate: '2026-03-31',
      subtotalMinor: '14500',
      discountMinor: '500',
      taxMinor: '2800',
      totalMinor: '16800',
      paidMinor: '0',
      dueMinor: '16800',
      template: 'classic',
    });
    expect(invoice.client).toMatchObject({ name: 'Acme Studios' });
    expect(invoice.project).toBeNull();
    expect(invoice.items).toHaveLength(2);
    expect(invoice.items[0]).toMatchObject({
      description: 'Design',
      quantityMilli: 1_500,
      unitPriceMinor: '8000',
      taxRateBps: 2_000,
      totalMinor: '14400',
      position: 0,
    });
    expect(invoice.items[1]).toMatchObject({ totalMinor: '2400', position: 1 });

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: 'invoice.created' },
    });
    expect(audit?.entityId).toBe(invoice.id);
  });

  it('numbers invoices per workspace and increments in sequence', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const clientId = await seedClient(owner);

    const first = await createDraft(owner, { clientId });
    const second = await createDraft(owner, { clientId });
    const foreign = await createDraft(other);

    expect(first.body.invoice.number).toBe('INV-0001');
    expect(second.body.invoice.number).toBe('INV-0002');
    expect(foreign.body.invoice.number).toBe('INV-0001');
  });

  it('links a project only when it belongs to the invoice client', async () => {
    const owner = await registerUser();
    const clientId = await seedClient(owner);
    const project = await api(owner).post('/projects').send({ clientId, name: 'Website' });
    expect(project.status).toBe(201);

    const linked = await createDraft(owner, {
      clientId,
      projectId: project.body.project.id as string,
    });
    expect(linked.status).toBe(201);
    expect(linked.body.invoice.project).toMatchObject({ name: 'Website' });

    const otherClientId = await seedClient(owner, 'Another Client');
    const mismatch = await createDraft(owner, {
      clientId: otherClientId,
      projectId: project.body.project.id as string,
    });
    expect(mismatch.status).toBe(400);
  });

  it('rejects invalid dates, items, discounts and unknown clients', async () => {
    const owner = await registerUser();
    const clientId = await seedClient(owner);

    const cases: Array<[string, DraftBody]> = [
      ['no items', draftBody(clientId, { items: [] })],
      ['inverted dates', draftBody(clientId, { issueDate: '2026-03-31', dueDate: '2026-03-01' })],
      ['impossible date', draftBody(clientId, { issueDate: '2026-02-30' })],
      [
        'zero quantity',
        draftBody(clientId, {
          items: [DESIGN_ITEM, { ...DESIGN_ITEM, quantityMilli: 0 }],
        }),
      ],
      [
        'discount above subtotal',
        draftBody(clientId, {
          items: [
            {
              description: 'Too much off',
              quantityMilli: 1_000,
              unitPriceMinor: '1000',
              discountMinor: '1001',
            },
          ],
        }),
      ],
      ['tax above 100%', draftBody(clientId, { items: [{ ...DESIGN_ITEM, taxRateBps: 10_001 }] })],
      ['empty description', draftBody(clientId, { items: [{ ...DESIGN_ITEM, description: ' ' }] })],
    ];

    for (const [label, body] of cases) {
      const response = await api(owner).post('/invoices').send(body);
      expect([400, 404]).toContain(response.status);
      if (response.status !== 400 && response.status !== 404) {
        throw new Error(`${label} produced ${response.status}`);
      }
    }

    const unknown = await createDraft(owner, {
      clientId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.status).toBe(404);
  });

  it('edits a draft and replaces its items atomically', async () => {
    const owner = await registerUser();
    const created = await createDraft(owner);
    const invoiceId = created.body.invoice.id as string;

    const updated = await api(owner)
      .patch(`/invoices/${invoiceId}`)
      .send({
        dueDate: '2026-04-15',
        notes: 'Thanks for your business.',
        items: [
          { description: 'Retainer', quantityMilli: 2_000, unitPriceMinor: '5000', taxRateBps: 0 },
        ],
      });

    expect(updated.status).toBe(200);
    expect(updated.body.invoice).toMatchObject({
      dueDate: '2026-04-15',
      notes: 'Thanks for your business.',
      subtotalMinor: '10000',
      discountMinor: '0',
      taxMinor: '0',
      totalMinor: '10000',
    });
    expect(updated.body.invoice.items).toHaveLength(1);
    expect(updated.body.invoice.items[0].description).toBe('Retainer');

    const emptied = await api(owner).patch(`/invoices/${invoiceId}`).send({});
    expect(emptied.status).toBe(400);

    const inverted = await api(owner)
      .patch(`/invoices/${invoiceId}`)
      .send({ issueDate: '2026-05-01' });
    expect(inverted.status).toBe(400);
  });

  it('issues a draft once and refuses further edits', async () => {
    const owner = await registerUser();
    const created = await createDraft(owner);
    const invoiceId = created.body.invoice.id as string;

    const issued = await api(owner).post(`/invoices/${invoiceId}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.body.invoice.status).toBe('SENT');
    expect(issued.body.invoice.sentAt).not.toBeNull();

    expect((await api(owner).post(`/invoices/${invoiceId}/issue`)).status).toBe(409);
    expect(
      (await api(owner).patch(`/invoices/${invoiceId}`).send({ notes: 'late edit' })).status,
    ).toBe(409);
  });

  it('lists invoices with status, client, search and derived overdue filters', async () => {
    const owner = await registerUser();
    const clientId = await seedClient(owner);
    const otherClientId = await seedClient(owner, 'Globex');

    const overdue = await createDraft(owner, {
      clientId,
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
    });
    await api(owner).post(`/invoices/${overdue.body.invoice.id as string}/issue`);

    const draft = await createDraft(owner, { clientId: otherClientId });
    expect(draft.status).toBe(201);

    const all = await api(owner).get('/invoices');
    expect(all.body.meta.total).toBe(2);

    const overdueList = await api(owner).get('/invoices?status=OVERDUE');
    expect(overdueList.body.meta.total).toBe(1);
    expect(overdueList.body.data[0].number).toBe('INV-0001');
    expect(overdueList.body.data[0].isOverdue).toBe(true);

    const drafts = await api(owner).get('/invoices?status=DRAFT');
    expect(drafts.body.meta.total).toBe(1);

    const byClient = await api(owner).get(`/invoices?clientId=${clientId}`);
    expect(byClient.body.meta.total).toBe(1);

    const globex = await api(owner).get('/invoices?search=Globex');
    expect(globex.body.meta.total).toBe(1);
    expect(globex.body.data[0].client.name).toBe('Globex');

    const byNumber = await api(owner).get('/invoices?search=INV-0002');
    expect(byNumber.body.meta.total).toBe(1);

    const byDate = await api(owner).get('/invoices?from=2026-01-01&to=2026-01-31');
    expect(byDate.body.meta.total).toBe(1);
  });

  it('voids an issued invoice but never one with completed payments', async () => {
    const owner = await registerUser();
    const clientId = await seedClient(owner);
    const created = await createDraft(owner, { clientId });
    const invoiceId = created.body.invoice.id as string;
    await api(owner).post(`/invoices/${invoiceId}/issue`);

    const voided = await api(owner).post(`/invoices/${invoiceId}/void`);
    expect(voided.status).toBe(200);
    expect(voided.body.invoice.status).toBe('VOID');
    expect(voided.body.invoice.voidedAt).not.toBeNull();
    expect((await api(owner).post(`/invoices/${invoiceId}/void`)).status).toBe(409);

    const paid = await createDraft(owner, { clientId });
    const paidId = paid.body.invoice.id as string;
    await api(owner).post(`/invoices/${paidId}/issue`);
    await prisma.payment.create({
      data: {
        workspaceId: owner.workspaceId,
        invoiceId: paidId,
        kind: 'PAYMENT',
        status: 'COMPLETED',
        amountMinor: 1_000n,
        paidAt: new Date('2026-03-05T00:00:00.000Z'),
        recordedById: owner.userId,
      },
    });

    const blocked = await api(owner).post(`/invoices/${paidId}/void`);
    expect(blocked.status).toBe(409);
  });

  it('deletes a draft but refuses to delete an issued invoice', async () => {
    const owner = await registerUser();
    const clientId = await seedClient(owner);
    const draft = await createDraft(owner, { clientId });
    const draftId = draft.body.invoice.id as string;

    expect((await api(owner).delete(`/invoices/${draftId}`)).status).toBe(204);
    expect((await api(owner).get(`/invoices/${draftId}`)).status).toBe(404);

    const issued = await createDraft(owner, { clientId });
    const issuedId = issued.body.invoice.id as string;
    await api(owner).post(`/invoices/${issuedId}/issue`);
    expect((await api(owner).delete(`/invoices/${issuedId}`)).status).toBe(409);
  });

  it('enforces permissions and tenant isolation', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const accountant = await registerUser();
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
          userId: accountant.userId,
          role: 'ACCOUNTANT',
          acceptedAt: new Date(),
        },
      ],
    });
    const viewerSession = { ...viewer, workspaceId: owner.workspaceId };
    const accountantSession = { ...accountant, workspaceId: owner.workspaceId };

    const clientId = await seedClient(owner);
    const created = await createDraft(owner, { clientId });
    const invoiceId = created.body.invoice.id as string;

    expect((await api(viewerSession).get('/invoices')).status).toBe(200);
    expect((await api(viewerSession).post('/invoices').send(draftBody(clientId))).status).toBe(403);

    const accountantDraft = await api(accountantSession)
      .post('/invoices')
      .send(draftBody(clientId));
    expect(accountantDraft.status).toBe(201);
    const accountantId = accountantDraft.body.invoice.id as string;
    expect((await api(accountantSession).post(`/invoices/${accountantId}/issue`)).status).toBe(200);
    expect((await api(accountantSession).delete(`/invoices/${accountantId}`)).status).toBe(403);

    const outsider = await registerUser();
    expect((await api(outsider).get(`/invoices/${invoiceId}`)).status).toBe(404);
  });
});
