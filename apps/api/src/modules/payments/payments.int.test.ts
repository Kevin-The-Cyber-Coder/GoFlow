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
  const email = `payment${counter}@example.test`;
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
  };
}

/** A single-line invoice whose total is exactly 100000 minor units. */
async function issuedInvoice(session: Session, totalMinor = '100000'): Promise<string> {
  const client = await api(session).post('/clients').send({ name: 'Paying Client' });
  expect(client.status).toBe(201);

  const draft = await api(session)
    .post('/invoices')
    .send({
      clientId: client.body.client.id,
      issueDate: '2026-03-01',
      dueDate: '2026-03-31',
      items: [
        {
          description: 'Retainer',
          quantityMilli: 1_000,
          unitPriceMinor: totalMinor,
          taxRateBps: 0,
        },
      ],
    });
  expect(draft.status).toBe(201);
  expect(draft.body.invoice.totalMinor).toBe(totalMinor);

  const issued = await api(session).post(`/invoices/${draft.body.invoice.id}/issue`);
  expect(issued.status).toBe(200);
  return draft.body.invoice.id as string;
}

describe('payments', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records partial payments and settles the invoice with the last one', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner);

    const partial = await api(owner)
      .post('/payments')
      .send({ invoiceId, amountMinor: '40000', paidAt: '2026-03-05' });
    expect(partial.status).toBe(201);
    expect(partial.body.payment).toMatchObject({
      invoiceId,
      kind: 'PAYMENT',
      status: 'COMPLETED',
      amountMinor: '40000',
      currency: 'USD',
      method: 'BANK_TRANSFER',
      paidAt: '2026-03-05',
      recordedById: owner.userId,
    });

    const afterPartial = await api(owner).get(`/invoices/${invoiceId}`);
    expect(afterPartial.body.invoice).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: '40000',
      dueMinor: '60000',
      paidAt: null,
    });

    const settled = await api(owner).post('/payments').send({ invoiceId, amountMinor: '60000' });
    expect(settled.status).toBe(201);

    const afterFull = await api(owner).get(`/invoices/${invoiceId}`);
    expect(afterFull.body.invoice).toMatchObject({
      status: 'PAID',
      paidMinor: '100000',
      dueMinor: '0',
    });
    expect(afterFull.body.invoice.paidAt).not.toBeNull();

    const list = await api(owner).get(`/payments?invoiceId=${invoiceId}`);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);
    expect(list.body.data.map((payment: { amountMinor: string }) => payment.amountMinor)).toEqual([
      '60000',
      '40000',
    ]);
  });

  it('refuses to record more than the outstanding balance', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner);

    const tooMuch = await api(owner).post('/payments').send({ invoiceId, amountMinor: '100001' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.details[0].path).toBe('amountMinor');

    const zero = await api(owner).post('/payments').send({ invoiceId, amountMinor: '0' });
    expect(zero.status).toBe(400);

    const negative = await api(owner).post('/payments').send({ invoiceId, amountMinor: '-100' });
    expect(negative.status).toBe(400);

    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(0);
  });

  it('only accepts money against an issued, unvoided invoice', async () => {
    const owner = await registerUser();
    const client = await api(owner).post('/clients').send({ name: 'Draft Client' });
    const draft = await api(owner)
      .post('/invoices')
      .send({
        clientId: client.body.client.id,
        issueDate: '2026-03-01',
        dueDate: '2026-03-31',
        items: [{ description: 'Work', quantityMilli: 1_000, unitPriceMinor: '5000' }],
      });
    expect(draft.status).toBe(201);

    const onDraft = await api(owner)
      .post('/payments')
      .send({ invoiceId: draft.body.invoice.id, amountMinor: '5000' });
    expect(onDraft.status).toBe(409);

    const invoiceId = await issuedInvoice(owner, '10000');
    const paid = await api(owner).post('/payments').send({ invoiceId, amountMinor: '10000' });
    expect(paid.status).toBe(201);

    const repeat = await api(owner).post('/payments').send({ invoiceId, amountMinor: '10000' });
    expect(repeat.status).toBe(409);
  });

  it('treats a repeated idempotency key as the same payment', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner);

    const body = { invoiceId, amountMinor: '25000', idempotencyKey: 'retry-1' };
    const first = await api(owner).post('/payments').send(body);
    expect(first.status).toBe(201);

    const second = await api(owner).post('/payments').send(body);
    expect(second.status).toBe(200);
    expect(second.body.payment.id).toBe(first.body.payment.id);

    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(1);

    const after = await api(owner).get(`/invoices/${invoiceId}`);
    expect(after.body.invoice.paidMinor).toBe('25000');
  });

  it('serialises concurrent payments so the invoice cannot be overpaid', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(owner).post('/payments').send({ invoiceId, amountMinor: '40000' }),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status !== 201);
    expect(created).toHaveLength(2);
    expect(rejected).toHaveLength(3);

    const invoice = await api(owner).get(`/invoices/${invoiceId}`);
    expect(invoice.body.invoice.status).toBe('PARTIALLY_PAID');
    expect(invoice.body.invoice.paidMinor).toBe('80000');
    expect(invoice.body.invoice.dueMinor).toBe('20000');
  });

  it('reverses a payment and reopens the invoice', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner);

    const payment = await api(owner).post('/payments').send({ invoiceId, amountMinor: '100000' });
    expect(payment.status).toBe(201);

    const reversed = await api(owner)
      .post(`/payments/${payment.body.payment.id}/reverse`)
      .send({ reason: 'Bank transfer bounced' });
    expect(reversed.status).toBe(200);
    expect(reversed.body.payment.status).toBe('REVERSED');
    expect(reversed.body.payment.reversedAt).not.toBeNull();

    const invoice = await api(owner).get(`/invoices/${invoiceId}`);
    expect(invoice.body.invoice).toMatchObject({
      status: 'SENT',
      paidMinor: '0',
      dueMinor: '100000',
      paidAt: null,
    });

    const again = await api(owner).post(`/payments/${payment.body.payment.id}/reverse`).send({});
    expect(again.status).toBe(409);

    const trail = await api(owner).get('/audit?entityId=' + payment.body.payment.id);
    expect(trail.body.entries.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining(['payment.reversed', 'payment.recorded']),
    );
  });

  it('enforces payment permissions and tenant scoping', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const employee = await registerUser();
    const stranger = await registerUser();

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

    const invoiceId = await issuedInvoice(owner);
    const payment = await api(owner).post('/payments').send({ invoiceId, amountMinor: '10000' });
    expect(payment.status).toBe(201);

    const viewerSession = { ...viewer, workspaceId: owner.workspaceId };
    const employeeSession = { ...employee, workspaceId: owner.workspaceId };

    expect((await api(viewerSession).get('/payments')).status).toBe(200);
    expect(
      (await api(viewerSession).post('/payments').send({ invoiceId, amountMinor: '10000' })).status,
    ).toBe(403);
    expect((await api(employeeSession).get('/payments')).status).toBe(403);

    expect(
      (await api(stranger).post('/payments').send({ invoiceId, amountMinor: '10000' })).status,
    ).toBe(404);
    expect(
      (await api(stranger).post(`/payments/${payment.body.payment.id}/reverse`).send({})).status,
    ).toBe(404);
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(1);
  });

  it('filters the ledger by date, kind and status', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner);

    await api(owner)
      .post('/payments')
      .send({ invoiceId, amountMinor: '10000', paidAt: '2026-03-05' });
    await api(owner)
      .post('/payments')
      .send({ invoiceId, amountMinor: '10000', paidAt: '2026-04-10' });

    const inRange = await api(owner).get('/payments?from=2026-03-01&to=2026-03-31');
    expect(inRange.body.meta.total).toBe(1);
    expect(inRange.body.data[0].paidAt).toBe('2026-03-05');

    const byKind = await api(owner).get('/payments?kind=PAYMENT');
    expect(byKind.body.meta.total).toBe(2);

    const byStatus = await api(owner).get('/payments?status=REVERSED');
    expect(byStatus.body.meta.total).toBe(0);

    const impossibleDate = await api(owner).get('/payments?from=2026-02-31');
    expect(impossibleDate.status).toBe(400);
  });
});
