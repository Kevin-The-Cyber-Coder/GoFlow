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
let invoiceCounter = 0;

async function registerUser(): Promise<Session> {
  counter += 1;
  const email = `report${counter}@example.test`;
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
  };
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: 'VIEWER' | 'EMPLOYEE' | 'ACCOUNTANT',
): Promise<void> {
  await prisma.workspaceMember.create({
    data: { workspaceId, userId, role, acceptedAt: new Date() },
  });
}

/** Issues an invoice for one line worth `totalMinor`, dated inside March 2026. */
async function issuedInvoice(session: Session, totalMinor: string): Promise<string> {
  invoiceCounter += 1;
  const client = await api(session)
    .post('/clients')
    .send({ name: `Reporting Client ${invoiceCounter}` });
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

  const issued = await api(session).post(`/invoices/${draft.body.invoice.id}/issue`);
  expect(issued.status).toBe(200);

  return draft.body.invoice.id as string;
}

async function pay(session: Session, invoiceId: string, amountMinor: string, paidAt: string) {
  const response = await api(session).post('/payments').send({ invoiceId, amountMinor, paidAt });
  expect(response.status).toBe(201);
  return response.body.payment.id as string;
}

async function recordExpense(session: Session, overrides: Record<string, unknown> = {}) {
  const response = await api(session)
    .post('/expenses')
    .send({
      description: 'Adobe subscription',
      amountMinor: '4599',
      date: '2026-03-02',
      vendor: 'Adobe',
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.expense.id as string;
}

describe('report summary', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sums income, approved expenses, net and outstanding money', async () => {
    const owner = await registerUser();
    const paidInvoice = await issuedInvoice(owner, '100000');
    await pay(owner, paidInvoice, '40000', '2026-03-05');

    const otherInvoice = await issuedInvoice(owner, '50000');
    await pay(owner, otherInvoice, '50000', '2026-03-06');

    await recordExpense(owner, { amountMinor: '4599', date: '2026-03-02' });
    const rejected = await recordExpense(owner, { amountMinor: '9999', date: '2026-03-03' });
    const review = await api(owner)
      .post(`/expenses/${rejected}/review`)
      .send({ status: 'REJECTED' });
    expect(review.status).toBe(200);

    const response = await api(owner).get('/reports/summary?from=2026-03-01&to=2026-03-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      currency: 'USD',
      from: '2026-03-01',
      to: '2026-03-31',
      incomeMinor: '90000',
      expensesMinor: '4599',
      netMinor: '85401',
      // 60000 still due on the first invoice; the second one is settled.
      outstandingMinor: '60000',
      paymentCount: 2,
      expenseCount: 1,
      outstandingInvoiceCount: 1,
    });
  });

  it('reopens outstanding money when a payment is reversed', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner, '100000');
    const paymentId = await pay(owner, invoiceId, '100000', '2026-03-05');

    const before = await api(owner).get('/reports/summary?from=2026-03-01&to=2026-03-31');
    expect(before.body).toMatchObject({
      incomeMinor: '100000',
      outstandingMinor: '0',
      outstandingInvoiceCount: 0,
    });

    const reversed = await api(owner).post(`/payments/${paymentId}/reverse`).send({});
    expect(reversed.status).toBe(200);

    const after = await api(owner).get('/reports/summary?from=2026-03-01&to=2026-03-31');
    expect(after.body).toMatchObject({
      incomeMinor: '0',
      paymentCount: 0,
      outstandingMinor: '100000',
      outstandingInvoiceCount: 1,
    });
  });

  it('excludes other periods, currencies and unapproved expenses', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner, '120000');
    await pay(owner, invoiceId, '20000', '2026-04-02');

    await recordExpense(owner, { amountMinor: '1000', date: '2026-02-15' });
    await recordExpense(owner, { amountMinor: '2500', date: '2026-03-10', currency: 'EUR' });
    await recordExpense(owner, { amountMinor: '3000', date: '2026-03-11' });

    const usd = await api(owner).get('/reports/summary?from=2026-03-01&to=2026-03-31');
    expect(usd.body).toMatchObject({
      currency: 'USD',
      incomeMinor: '0',
      expensesMinor: '3000',
      paymentCount: 0,
      expenseCount: 1,
    });

    const eur = await api(owner).get('/reports/summary?from=2026-03-01&to=2026-03-31&currency=eur');
    expect(eur.body).toMatchObject({
      currency: 'EUR',
      incomeMinor: '0',
      expensesMinor: '2500',
      expenseCount: 1,
    });
  });

  it('includes the whole of the end day and the issue date in the range', async () => {
    const owner = await registerUser();
    const invoiceId = await issuedInvoice(owner, '10000');
    await pay(owner, invoiceId, '10000', '2026-03-31');

    const response = await api(owner).get('/reports/summary?from=2026-03-31&to=2026-03-31');
    expect(response.body).toMatchObject({
      incomeMinor: '10000',
      outstandingInvoiceCount: 0,
    });
  });

  it('enforces reports:read and tenant scoping', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const employee = await registerUser();
    const stranger = await registerUser();
    await addMember(owner.workspaceId, viewer.userId, 'VIEWER');
    await addMember(owner.workspaceId, employee.userId, 'EMPLOYEE');

    const invoiceId = await issuedInvoice(owner, '10000');
    await pay(owner, invoiceId, '10000', '2026-03-04');
    await recordExpense(owner, { amountMinor: '1000', date: '2026-03-04' });

    const viewerResponse = await api({ ...viewer, workspaceId: owner.workspaceId }).get(
      '/reports/summary?from=2026-03-01&to=2026-03-31',
    );
    expect(viewerResponse.status).toBe(200);
    expect(viewerResponse.body.incomeMinor).toBe('10000');

    const employeeResponse = await api({ ...employee, workspaceId: owner.workspaceId }).get(
      '/reports/summary?from=2026-03-01&to=2026-03-31',
    );
    expect(employeeResponse.status).toBe(403);

    const foreign = await api({ ...stranger, workspaceId: owner.workspaceId }).get(
      '/reports/summary?from=2026-03-01&to=2026-03-31',
    );
    expect(foreign.status).toBe(404);

    const own = await api(stranger).get('/reports/summary?from=2026-03-01&to=2026-03-31');
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      incomeMinor: '0',
      expensesMinor: '0',
      outstandingMinor: '0',
      paymentCount: 0,
    });
  });

  it('rejects unbounded and malformed periods', async () => {
    const owner = await registerUser();

    const reverse = await api(owner).get('/reports/summary?from=2026-04-01&to=2026-03-01');
    expect(reverse.status).toBe(400);

    const tooLong = await api(owner).get('/reports/summary?from=2025-01-01&to=2026-03-01');
    expect(tooLong.status).toBe(400);

    const impossible = await api(owner).get('/reports/summary?from=2026-02-31&to=2026-03-01');
    expect(impossible.status).toBe(400);

    const missing = await api(owner).get('/reports/summary?from=2026-03-01');
    expect(missing.status).toBe(400);

    const currency = await api(owner).get(
      '/reports/summary?from=2026-03-01&to=2026-03-31&currency=us',
    );
    expect(currency.status).toBe(400);
  });
});
