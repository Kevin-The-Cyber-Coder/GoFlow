import { Router } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import { reportSummarySchema } from './schemas';
import { reportSummary } from './service';

export const reportRouter: Router = Router();

reportRouter.use(requireAuth, resolveWorkspace);

/**
 * Income, spending and outstanding money for one currency and period.
 *
 * `reports:read` is granted to viewer and above, because seeing the summary is
 * what a viewer exists for; exporting it is a separate permission.
 */
reportRouter.get(
  '/summary',
  requirePermission('reports:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    const query = reportSummarySchema.parse(req.query);
    res.status(200).json(await reportSummary(id, query));
  }),
);
