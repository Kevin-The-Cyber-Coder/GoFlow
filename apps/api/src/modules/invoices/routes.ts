import { Router, type Request } from 'express';
import { createInvoiceSchema, invoiceListQuerySchema, updateInvoiceSchema } from '@goflow/shared';

import { badRequest } from '../../lib/errors';
import { isUuid } from '../../lib/ids';
import { parseQuery, validateBody } from '../../middleware/validate';
import { workspaceIdOf } from '../../middleware/workspace';
import type { InvoiceService } from './service';

function invoiceIdOf(req: Request): string {
  const id = req.params.id;

  if (!isUuid(id)) {
    throw badRequest('Invoice id must be a UUID.', 'INVALID_INVOICE_ID');
  }

  return id;
}

export interface InvoicesRouterDependencies {
  service: InvoiceService;
}

export function createInvoicesRouter({ service }: InvoicesRouterDependencies): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseQuery(invoiceListQuerySchema, req);
    const page = await service.list(workspaceIdOf(req), query);

    res.status(200).json({ data: page });
  });

  router.post('/', validateBody(createInvoiceSchema), async (req, res) => {
    const invoice = await service.create(workspaceIdOf(req), req.body);

    res.status(201).json({ data: invoice });
  });

  router.get('/:id', async (req, res) => {
    const invoice = await service.get(workspaceIdOf(req), invoiceIdOf(req));

    res.status(200).json({ data: invoice });
  });

  /**
   * Only drafts are editable. The service enforces this rather than the route,
   * so the rule cannot be bypassed by another caller.
   */
  router.patch('/:id', validateBody(updateInvoiceSchema), async (req, res) => {
    const invoice = await service.update(workspaceIdOf(req), invoiceIdOf(req), req.body);

    res.status(200).json({ data: invoice });
  });

  router.delete('/:id', async (req, res) => {
    await service.remove(workspaceIdOf(req), invoiceIdOf(req));

    res.status(204).send();
  });

  router.post('/:id/send', async (req, res) => {
    const invoice = await service.send(workspaceIdOf(req), invoiceIdOf(req));

    res.status(200).json({ data: invoice });
  });

  router.post('/:id/cancel', async (req, res) => {
    const invoice = await service.cancel(workspaceIdOf(req), invoiceIdOf(req));

    res.status(200).json({ data: invoice });
  });

  router.post('/:id/void', async (req, res) => {
    const invoice = await service.void(workspaceIdOf(req), invoiceIdOf(req));

    res.status(200).json({ data: invoice });
  });

  return router;
}
