import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import {
  createTimeEntrySchema,
  listTimeEntriesSchema,
  timeSummarySchema,
  updateTimeEntrySchema,
} from './schemas';
import {
  createTimeEntry,
  deleteTimeEntry,
  listTimeEntries,
  timeSummary,
  updateTimeEntry,
} from './service';

export const timeRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

timeRouter.use(requireAuth, resolveWorkspace);

timeRouter.get(
  '/entries',
  requirePermission('time:read'),
  asyncHandler(async (req, res) => {
    const { id, userId, role } = workspaceContext(req);
    const query = listTimeEntriesSchema.parse(req.query);
    res.status(200).json(await listTimeEntries(id, role, userId, query));
  }),
);

timeRouter.post(
  '/entries',
  requirePermission('time:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createTimeEntrySchema.parse(req.body);
    res.status(201).json({ entry: await createTimeEntry(id, userId, email, input, metaOf(req)) });
  }),
);

timeRouter.patch(
  '/entries/:entryId',
  requirePermission('time:write'),
  asyncHandler(async (req, res) => {
    const { id, userId, role } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateTimeEntrySchema.parse(req.body);
    const entry = await updateTimeEntry(
      id,
      userId,
      email,
      role,
      param(req, 'entryId'),
      input,
      metaOf(req),
    );
    res.status(200).json({ entry });
  }),
);

timeRouter.delete(
  '/entries/:entryId',
  requirePermission('time:write'),
  asyncHandler(async (req, res) => {
    const { id, userId, role } = workspaceContext(req);
    const { email } = authContext(req);
    await deleteTimeEntry(id, userId, email, role, param(req, 'entryId'), metaOf(req));
    res.status(204).send();
  }),
);

timeRouter.get(
  '/summary',
  requirePermission('time:read'),
  asyncHandler(async (req, res) => {
    const { id, userId, role } = workspaceContext(req);
    const query = timeSummarySchema.parse(req.query);
    res.status(200).json(await timeSummary(id, role, userId, query));
  }),
);
