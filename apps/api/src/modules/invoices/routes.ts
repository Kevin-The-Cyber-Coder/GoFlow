import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import { createInvoiceSchema, listInvoicesSchema, updateInvoiceSchema } from './schemas';
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  updateInvoice,
  voidInvoice,
} from './service';

export const invoiceRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

invoiceRouter.use(requireAuth, resolveWorkspace);

invoiceRouter.get(
  '/',
  requirePermission('invoices:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json(await listInvoices(id, listInvoicesSchema.parse(req.query)));
  }),
);

invoiceRouter.post(
  '/',
  requirePermission('invoices:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createInvoiceSchema.parse(req.body);
    res.status(201).json({ invoice: await createInvoice(id, userId, email, input, metaOf(req)) });
  }),
);

invoiceRouter.get(
  '/:invoiceId',
  requirePermission('invoices:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json({ invoice: await getInvoice(id, param(req, 'invoiceId')) });
  }),
);

invoiceRouter.patch(
  '/:invoiceId',
  requirePermission('invoices:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateInvoiceSchema.parse(req.body);
    res.status(200).json({
      invoice: await updateInvoice(id, userId, email, param(req, 'invoiceId'), input, metaOf(req)),
    });
  }),
);

invoiceRouter.post(
  '/:invoiceId/issue',
  requirePermission('invoices:send'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    res.status(200).json({
      invoice: await issueInvoice(id, userId, email, param(req, 'invoiceId'), metaOf(req)),
    });
  }),
);

invoiceRouter.post(
  '/:invoiceId/void',
  requirePermission('invoices:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    res.status(200).json({
      invoice: await voidInvoice(id, userId, email, param(req, 'invoiceId'), metaOf(req)),
    });
  }),
);

invoiceRouter.delete(
  '/:invoiceId',
  requirePermission('invoices:delete'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    await deleteInvoice(id, userId, email, param(req, 'invoiceId'), metaOf(req));
    res.status(204).send();
  }),
);
