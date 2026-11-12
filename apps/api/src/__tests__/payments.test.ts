import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';

import { createTestContext, resetDatabase, type TestContext } from './helpers/test-app';

interface Session {
  token: string;
  workspaceId: string;
}

const PASSWORD = 'correct-horse-battery-staple';

async function register(app: Express, email = 'kevin@example.com'): Promise<Session> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, name: 'Kevin' });

  return {
    token: response.body.data.accessToken,
    workspaceId: response.body.data.workspace.id,
  };
}

function authorized(test: request.Test, session: Session): request.Test {
  return test.set('Authorization', `Bearer ${session.token}`);
}

describe('payments', () => {
  let context: TestContext;
  let session: Session;
  let invoiceId: string;

  const invoicePath = () => `/api/v1/invoices/${invoiceId}`;

  async function createSentInvoice(overrides: Record<string, unknown> = {}) {
    const client = await authorized(request(context.app).post('/api/v1/clients'), session).send({
      name: 'Acme Studio',
    });

    const invoice = await authorized(request(context.app).post('/api/v1/invoices'), session).send({
      clientId: client.body.data.id,
      issueDate: '2026-11-01',
      dueDate: '2026-11-30',
      items: [
        { description: 'Design work', quantity: '10', unitPriceMinor: 10_000, taxRateBps: 0 },
      ],
      ...overrides,
    });

    invoiceId = invoice.body.data.id;

    await authorized(request(context.app).post(`/api/v1/invoices/${invoiceId}/send`), session);

    return invoice.body.data as { id: string; totalMinor: number };
  }

  beforeAll(async () => {
    context = await createTestContext();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await resetDatabase(context.db);
    session = await register(context.app);
  });

  describe('POST /api/v1/invoices/:id/payments', () => {
    it('records a partial payment and updates the invoice', async () => {
      await createSentInvoice();

      const response = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 40_000, method: 'card', reference: 'ch_123' });

      expect(response.status).toBe(201);
      expect(response.body.data.payment).toMatchObject({
        invoiceId,
        amountMinor: 40_000,
        currency: 'USD',
        method: 'card',
        reference: 'ch_123',
      });
      expect(response.body.data.payment.paidAt).toEqual(expect.any(String));
      expect(response.body.data.invoice).toMatchObject({
        amountPaidMinor: 40_000,
        balanceMinor: 60_000,
        paymentStatus: 'partial',
      });
    });

    it('marks the invoice paid once the balance is settled', async () => {
      await createSentInvoice();

      await authorized(request(context.app).post(`${invoicePath()}/payments`), session).send({
        amountMinor: 60_000,
      });
      const response = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 40_000 });

      expect(response.body.data.invoice).toMatchObject({
        amountPaidMinor: 100_000,
        balanceMinor: 0,
        paymentStatus: 'paid',
      });
    });

    it('uses the invoice currency', async () => {
      await createSentInvoice({ currency: 'EUR' });

      const response = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 1_000 });

      expect(response.body.data.payment.currency).toBe('EUR');
    });

    it('rejects a payment that exceeds the balance', async () => {
      await createSentInvoice();

      const response = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 100_001 });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
    });

    it('rejects a payment on a draft invoice', async () => {
      const client = await authorized(request(context.app).post('/api/v1/clients'), session).send({
        name: 'Acme Studio',
      });
      const draft = await authorized(request(context.app).post('/api/v1/invoices'), session).send({
        clientId: client.body.data.id,
        issueDate: '2026-11-01',
        dueDate: '2026-11-30',
        items: [{ description: 'Work', quantity: '1', unitPriceMinor: 1_000, taxRateBps: 0 }],
      });
      invoiceId = draft.body.data.id;

      const response = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 100 });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    });

    it('rejects a payment on a voided invoice', async () => {
      await createSentInvoice();
      await authorized(request(context.app).post(`${invoicePath()}/void`), session);

      const response = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 100 });

      expect(response.status).toBe(409);
    });

    it('rejects invalid amounts and unknown fields', async () => {
      await createSentInvoice();

      const invalidAmount = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 0 });
      const unknownField = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 100, currency: 'USD' });

      expect(invalidAmount.status).toBe(400);
      expect(unknownField.status).toBe(400);
    });

    it('requires authentication', async () => {
      await createSentInvoice();

      const response = await request(context.app)
        .post(`${invoicePath()}/payments`)
        .send({ amountMinor: 100 });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/invoices/:id/payments', () => {
    it('lists payments in the order they were paid', async () => {
      await createSentInvoice();

      await authorized(request(context.app).post(`${invoicePath()}/payments`), session).send({
        amountMinor: 10_000,
        paidAt: '2026-11-05T10:00:00.000Z',
      });
      await authorized(request(context.app).post(`${invoicePath()}/payments`), session).send({
        amountMinor: 20_000,
        paidAt: '2026-11-02T10:00:00.000Z',
      });

      const response = await authorized(
        request(context.app).get(`${invoicePath()}/payments`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(
        response.body.data.map((payment: { amountMinor: number }) => payment.amountMinor),
      ).toEqual([20_000, 10_000]);
    });

    it('returns 404 for an unknown invoice', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/invoices/00000000-0000-4000-8000-000000000000/payments'),
        session,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/invoices/:id/payments/:paymentId', () => {
    it('removes a payment and recomputes the invoice total', async () => {
      await createSentInvoice();

      const first = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 30_000 });
      await authorized(request(context.app).post(`${invoicePath()}/payments`), session).send({
        amountMinor: 20_000,
      });

      const response = await authorized(
        request(context.app).delete(`${invoicePath()}/payments/${first.body.data.payment.id}`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        amountPaidMinor: 20_000,
        balanceMinor: 80_000,
        paymentStatus: 'partial',
      });

      const invoice = await authorized(request(context.app).get(invoicePath()), session);
      expect(invoice.body.data.amountPaidMinor).toBe(20_000);
    });

    it('returns 404 for an unknown payment', async () => {
      await createSentInvoice();

      const response = await authorized(
        request(context.app).delete(
          `${invoicePath()}/payments/00000000-0000-4000-8000-000000000000`,
        ),
        session,
      );

      expect(response.status).toBe(404);
    });

    it('returns 400 for a malformed payment id', async () => {
      await createSentInvoice();

      const response = await authorized(
        request(context.app).delete(`${invoicePath()}/payments/not-a-uuid`),
        session,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PAYMENT_ID');
    });
  });

  describe('workspace isolation', () => {
    it('does not expose payments to another workspace', async () => {
      await createSentInvoice();

      const created = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        session,
      ).send({ amountMinor: 1_000 });
      const other = await register(context.app, 'other@example.com');

      const list = await authorized(request(context.app).get(`${invoicePath()}/payments`), other);
      const create = await authorized(
        request(context.app).post(`${invoicePath()}/payments`),
        other,
      ).send({ amountMinor: 1_000 });
      const remove = await authorized(
        request(context.app).delete(`${invoicePath()}/payments/${created.body.data.payment.id}`),
        other,
      );

      expect(list.status).toBe(404);
      expect(create.status).toBe(404);
      expect(remove.status).toBe(404);
    });
  });
});
