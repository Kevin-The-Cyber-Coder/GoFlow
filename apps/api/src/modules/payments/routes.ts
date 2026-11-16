import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import { createPaymentSchema, listPaymentsSchema, reversePaymentSchema } from './schemas';
import { createPayment, listPayments, reversePayment } from './service';

export const paymentRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

paymentRouter.use(requireAuth, resolveWorkspace);

paymentRouter.get(
  '/',
  requirePermission('payments:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json(await listPayments(id, listPaymentsSchema.parse(req.query)));
  }),
);

paymentRouter.post(
  '/',
  requirePermission('payments:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createPaymentSchema.parse(req.body);
    const result = await createPayment(id, userId, email, input, metaOf(req));
    // A replayed idempotency key is not a new resource, so it is a 200.
    res.status(result.created ? 201 : 200).json({ payment: result.payment });
  }),
);

paymentRouter.post(
  '/:id/reverse',
  requirePermission('payments:reverse'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = reversePaymentSchema.parse(req.body ?? {});
    const payment = await reversePayment(id, userId, email, param(req, 'id'), input, metaOf(req));
    res.status(200).json({ payment });
  }),
);
