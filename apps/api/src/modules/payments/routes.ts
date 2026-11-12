import { Router, type Request } from 'express';
import { createPaymentSchema } from '@goflow/shared';

import { badRequest } from '../../lib/errors';
import { isUuid } from '../../lib/ids';
import { validateBody } from '../../middleware/validate';
import { workspaceIdOf } from '../../middleware/workspace';
import type { PaymentService } from './service';

function invoiceIdOf(req: Request): string {
  const id = req.params.id;

  if (!isUuid(id)) {
    throw badRequest('Invoice id must be a UUID.', 'INVALID_INVOICE_ID');
  }

  return id;
}

function paymentIdOf(req: Request): string {
  const id = req.params.paymentId;

  if (!isUuid(id)) {
    throw badRequest('Payment id must be a UUID.', 'INVALID_PAYMENT_ID');
  }

  return id;
}

export interface PaymentsRouterDependencies {
  service: PaymentService;
}

/**
 * Mounted alongside the invoices router on `/api/v1/invoices`, so payments are
 * addressed relative to the invoice they belong to. That makes the workspace
 * scope impossible to forget.
 */
export function createPaymentsRouter({ service }: PaymentsRouterDependencies): Router {
  const router = Router();

  router.get('/:id/payments', async (req, res) => {
    const payments = await service.list(workspaceIdOf(req), invoiceIdOf(req));

    res.status(200).json({ data: payments });
  });

  router.post('/:id/payments', validateBody(createPaymentSchema), async (req, res) => {
    const result = await service.create(workspaceIdOf(req), invoiceIdOf(req), req.body);

    res.status(201).json({ data: result });
  });

  router.delete('/:id/payments/:paymentId', async (req, res) => {
    const invoice = await service.remove(workspaceIdOf(req), invoiceIdOf(req), paymentIdOf(req));

    res.status(200).json({ data: invoice });
  });

  return router;
}
