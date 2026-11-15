import { Router } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import { listAuditSchema } from './schemas';
import { listAuditEntries } from './service';

export const auditRouter: Router = Router();

auditRouter.use(requireAuth, resolveWorkspace);

/**
 * The workspace trail. Reading it is a money-visible operation — it is how an
 * owner answers "who changed this invoice and when" — so it is behind
 * `audit:read` rather than ordinary membership.
 */
auditRouter.get(
  '/',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    const query = listAuditSchema.parse(req.query);
    res.status(200).json(await listAuditEntries(id, query));
  }),
);
