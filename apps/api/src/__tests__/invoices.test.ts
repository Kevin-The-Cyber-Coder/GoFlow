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

async function createClient(app: Express, session: Session, name = 'Acme Studio') {
  const response = await authorized(request(app).post('/api/v1/clients'), session).send({ name });

  return response.body.data as { id: string; name: string };
}

interface InvoiceInput {
  clientId: string;
  issueDate?: string;
  dueDate?: string;
  notes?: string | null;
  terms?: string | null;
  currency?: string;
  discount?:
    | { type: 'none' }
    | { type: 'percent'; rateBps: number }
    | { type: 'fixed'; amountMinor: number };
  items?: {
    description: string;
    quantity: string;
    unitPriceMinor: number;
    taxRateBps: number;
  }[];
}

function invoiceBody(clientId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    clientId,
    issueDate: '2026-11-01',
    dueDate: '2026-11-30',
    items: [
      { description: 'Design work', quantity: '10', unitPriceMinor: 10_000, taxRateBps: 2_000 },
      { description: 'Hosting', quantity: '1', unitPriceMinor: 5_000, taxRateBps: 0 },
    ],
    ...overrides,
  };
}

async function createInvoice(
  app: Express,
  session: Session,
  clientId: string,
  overrides: Partial<InvoiceInput> = {},
) {
  const response = await authorized(request(app).post('/api/v1/invoices'), session).send(
    invoiceBody(clientId, overrides),
  );

  return response;
}

describe('invoices', () => {
  let context: TestContext;
  let session: Session;
  let client: { id: string; name: string };

  beforeAll(async () => {
    context = await createTestContext();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await resetDatabase(context.db);
    session = await register(context.app);
    client = await createClient(context.app, session);
  });

  describe('POST /api/v1/invoices', () => {
    it('creates a draft with computed totals and numbers it sequentially', async () => {
      const first = await createInvoice(context.app, session, client.id);
      const second = await createInvoice(context.app, session, client.id);

      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({
        number: 'INV-0001',
        status: 'draft',
        paymentStatus: 'unpaid',
        clientId: client.id,
        clientName: 'Acme Studio',
        currency: 'USD',
        issueDate: '2026-11-01',
        dueDate: '2026-11-30',
        subtotalMinor: 105_000,
        discountMinor: 0,
        taxMinor: 20_000,
        totalMinor: 125_000,
        amountPaidMinor: 0,
        balanceMinor: 125_000,
      });
      expect(first.body.data.items).toEqual([
        expect.objectContaining({
          description: 'Design work',
          quantity: '10',
          unitPriceMinor: 10_000,
          taxRateBps: 2_000,
          subtotalMinor: 100_000,
          taxMinor: 20_000,
          totalMinor: 120_000,
        }),
        expect.objectContaining({
          description: 'Hosting',
          quantity: '1',
          subtotalMinor: 5_000,
          taxMinor: 0,
          totalMinor: 5_000,
        }),
      ]);
      expect(second.body.data.number).toBe('INV-0002');
    });

    it('applies a percentage discount before tax and allocates it across lines', async () => {
      const response = await createInvoice(context.app, session, client.id, {
        discount: { type: 'percent', rateBps: 1_000 },
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        subtotalMinor: 105_000,
        discountMinor: 10_500,
        taxMinor: 18_000,
        totalMinor: 112_500,
      });
      expect(response.body.data.items[0].discountMinor).toBe(10_000);
      expect(response.body.data.items[1].discountMinor).toBe(500);
    });

    it('clamps a fixed discount at the subtotal', async () => {
      const response = await createInvoice(context.app, session, client.id, {
        discount: { type: 'fixed', amountMinor: 999_999 },
      });

      expect(response.body.data.discountMinor).toBe(105_000);
      expect(response.body.data.totalMinor).toBe(0);
    });

    it('returns fractional quantities as typed and rounds line totals half up', async () => {
      const response = await createInvoice(context.app, session, client.id, {
        items: [
          { description: 'Consulting', quantity: '1.5', unitPriceMinor: 3_333, taxRateBps: 0 },
        ],
      });

      expect(response.body.data.items[0]).toMatchObject({
        quantity: '1.5',
        subtotalMinor: 5_000,
        totalMinor: 5_000,
      });
    });

    it('uses the workspace currency unless one is given', async () => {
      const override = await createInvoice(context.app, session, client.id, { currency: 'EUR' });

      expect(override.body.data.currency).toBe('EUR');
    });

    it('requires authentication', async () => {
      const response = await request(context.app)
        .post('/api/v1/invoices')
        .send(invoiceBody(client.id));

      expect(response.status).toBe(401);
    });

    it('rejects a due date before the issue date', async () => {
      const response = await createInvoice(context.app, session, client.id, {
        dueDate: '2026-10-01',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'dueDate' })]),
      );
    });

    it('rejects an invoice without items', async () => {
      const response = await createInvoice(context.app, session, client.id, { items: [] });

      expect(response.status).toBe(400);
    });

    it('rejects unknown fields', async () => {
      const response = await authorized(
        request(context.app).post('/api/v1/invoices'),
        session,
      ).send({
        ...invoiceBody(client.id),
        status: 'sent',
      });

      expect(response.status).toBe(400);
    });

    it('rejects a client from another workspace', async () => {
      const other = await register(context.app, 'other@example.com');
      const otherClient = await createClient(context.app, other, 'Other Studio');

      const response = await createInvoice(context.app, session, otherClient.id);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/invoices', () => {
    it('filters by status, client and search term', async () => {
      const otherClient = await createClient(context.app, session, 'Zenith Labs');
      const acme = await createInvoice(context.app, session, client.id);
      await createInvoice(context.app, session, otherClient.id);
      await authorized(
        request(context.app).post(`/api/v1/invoices/${acme.body.data.id}/send`),
        session,
      );

      const drafts = await authorized(
        request(context.app).get('/api/v1/invoices?status=draft'),
        session,
      );
      const sent = await authorized(
        request(context.app).get('/api/v1/invoices?status=sent'),
        session,
      );
      const byClient = await authorized(
        request(context.app).get(`/api/v1/invoices?clientId=${client.id}`),
        session,
      );
      const byClientName = await authorized(
        request(context.app).get('/api/v1/invoices?search=zenith'),
        session,
      );
      const byNumber = await authorized(
        request(context.app).get('/api/v1/invoices?search=0002'),
        session,
      );

      expect(drafts.body.data.total).toBe(1);
      expect(drafts.body.data.items[0].clientName).toBe('Zenith Labs');
      expect(sent.body.data.total).toBe(1);
      expect(sent.body.data.items[0].id).toBe(acme.body.data.id);
      expect(byClient.body.data.total).toBe(1);
      expect(byClientName.body.data.total).toBe(1);
      expect(byNumber.body.data.total).toBe(1);
      expect(byNumber.body.data.items[0].clientName).toBe('Zenith Labs');
    });

    it('paginates newest issue date first', async () => {
      await createInvoice(context.app, session, client.id, {
        issueDate: '2026-01-01',
        dueDate: '2026-01-31',
      });
      await createInvoice(context.app, session, client.id, {
        issueDate: '2026-06-01',
        dueDate: '2026-06-30',
      });

      const response = await authorized(
        request(context.app).get('/api/v1/invoices?limit=1&offset=0'),
        session,
      );

      expect(response.body.data).toMatchObject({ total: 2, limit: 1, offset: 0 });
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].issueDate).toBe('2026-06-01');
    });

    it('validates pagination parameters', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/invoices?limit=500'),
        session,
      );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/invoices/:id', () => {
    it('returns the full invoice', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).get(`/api/v1/invoices/${created.body.data.id}`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(2);
      expect(response.body.data.discount).toEqual({ type: 'none' });
    });

    it('returns 400 for a malformed id', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/invoices/not-a-uuid'),
        session,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INVOICE_ID');
    });

    it('returns 404 for an unknown id', async () => {
      const response = await authorized(
        request(context.app).get('/api/v1/invoices/00000000-0000-4000-8000-000000000000'),
        session,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/invoices/:id', () => {
    it('replaces items and recomputes totals', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).patch(`/api/v1/invoices/${created.body.data.id}`),
        session,
      ).send({
        items: [
          { description: 'Retainer', quantity: '2', unitPriceMinor: 20_000, taxRateBps: 1_000 },
        ],
        notes: 'Updated',
        discount: { type: 'percent', rateBps: 500 },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data).toMatchObject({
        notes: 'Updated',
        subtotalMinor: 40_000,
        discountMinor: 2_000,
        taxMinor: 3_800,
        totalMinor: 41_800,
      });
    });

    it('recomputes when only the discount changes', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).patch(`/api/v1/invoices/${created.body.data.id}`),
        session,
      ).send({ discount: { type: 'percent', rateBps: 1_000 } });

      expect(response.body.data.subtotalMinor).toBe(105_000);
      expect(response.body.data.discountMinor).toBe(10_500);
      expect(response.body.data.items).toHaveLength(2);
    });

    it('rejects editing a sent invoice', async () => {
      const created = await createInvoice(context.app, session, client.id);
      await authorized(
        request(context.app).post(`/api/v1/invoices/${created.body.data.id}/send`),
        session,
      );

      const response = await authorized(
        request(context.app).patch(`/api/v1/invoices/${created.body.data.id}`),
        session,
      ).send({ notes: 'Too late' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVOICE_NOT_EDITABLE');
    });

    it('rejects an empty patch', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).patch(`/api/v1/invoices/${created.body.data.id}`),
        session,
      ).send({});

      expect(response.status).toBe(400);
    });

    it('rejects moving the due date before the issue date', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).patch(`/api/v1/invoices/${created.body.data.id}`),
        session,
      ).send({ dueDate: '2026-10-01' });

      expect(response.status).toBe(400);
    });
  });

  describe('status transitions', () => {
    it('sends a draft and records when it was sent', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).post(`/api/v1/invoices/${created.body.data.id}/send`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('sent');
      expect(response.body.data.sentAt).toEqual(expect.any(String));
    });

    it('refuses to send twice', async () => {
      const created = await createInvoice(context.app, session, client.id);
      const path = `/api/v1/invoices/${created.body.data.id}/send`;

      await authorized(request(context.app).post(path), session);
      const response = await authorized(request(context.app).post(path), session);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('cancels a draft and records when it was cancelled', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).post(`/api/v1/invoices/${created.body.data.id}/cancel`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('cancelled');
      expect(response.body.data.cancelledAt).toEqual(expect.any(String));
    });

    it('voids a sent invoice and records when it was voided', async () => {
      const created = await createInvoice(context.app, session, client.id);
      const id = created.body.data.id;

      await authorized(request(context.app).post(`/api/v1/invoices/${id}/send`), session);
      const response = await authorized(
        request(context.app).post(`/api/v1/invoices/${id}/void`),
        session,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('void');
      expect(response.body.data.voidedAt).toEqual(expect.any(String));
    });

    it('refuses to void a draft', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const response = await authorized(
        request(context.app).post(`/api/v1/invoices/${created.body.data.id}/void`),
        session,
      );

      expect(response.status).toBe(409);
    });
  });

  describe('DELETE /api/v1/invoices/:id', () => {
    it('deletes a draft', async () => {
      const created = await createInvoice(context.app, session, client.id);

      const deleted = await authorized(
        request(context.app).delete(`/api/v1/invoices/${created.body.data.id}`),
        session,
      );
      const fetched = await authorized(
        request(context.app).get(`/api/v1/invoices/${created.body.data.id}`),
        session,
      );

      expect(deleted.status).toBe(204);
      expect(fetched.status).toBe(404);
    });

    it('refuses to delete a sent invoice', async () => {
      const created = await createInvoice(context.app, session, client.id);
      const id = created.body.data.id;

      await authorized(request(context.app).post(`/api/v1/invoices/${id}/send`), session);
      const response = await authorized(
        request(context.app).delete(`/api/v1/invoices/${id}`),
        session,
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVOICE_NOT_DELETABLE');
    });
  });

  describe('workspace isolation', () => {
    it('does not expose an invoice to another workspace', async () => {
      const created = await createInvoice(context.app, session, client.id);
      const other = await register(context.app, 'other@example.com');

      const read = await authorized(
        request(context.app).get(`/api/v1/invoices/${created.body.data.id}`),
        other,
      );
      const list = await authorized(request(context.app).get('/api/v1/invoices'), other);
      const update = await authorized(
        request(context.app).patch(`/api/v1/invoices/${created.body.data.id}`),
        other,
      ).send({ notes: 'Stolen' });
      const send = await authorized(
        request(context.app).post(`/api/v1/invoices/${created.body.data.id}/send`),
        other,
      );

      expect(read.status).toBe(404);
      expect(list.body.data.items).toHaveLength(0);
      expect(update.status).toBe(404);
      expect(send.status).toBe(404);
    });
  });
});
