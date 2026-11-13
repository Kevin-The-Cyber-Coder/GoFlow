import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  transferOwnershipSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from './schemas';
import {
  createWorkspace,
  getWorkspace,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  roles,
  transferOwnership,
  updateMemberRole,
  updateWorkspace,
} from './service';

export const workspaceRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

workspaceRouter.use(requireAuth);

workspaceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    res.status(200).json({ workspaces: await listWorkspaces(userId) });
  }),
);

workspaceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, email } = authContext(req);
    const input = createWorkspaceSchema.parse(req.body);
    const workspace = await createWorkspace(userId, email, input, metaOf(req));
    res.status(201).json({ workspace });
  }),
);

workspaceRouter.get(
  '/roles',
  asyncHandler((_req, res) => {
    res.status(200).json({ roles: roles() });
  }),
);

// Everything below is scoped to one workspace and requires membership.
workspaceRouter.use('/:workspaceId', resolveWorkspace);

workspaceRouter.get(
  '/:workspaceId',
  requirePermission('workspace:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json({ workspace: await getWorkspace(id) });
  }),
);

workspaceRouter.patch(
  '/:workspaceId',
  requirePermission('workspace:update'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateWorkspaceSchema.parse(req.body);
    const workspace = await updateWorkspace(id, userId, email, input, metaOf(req));
    res.status(200).json({ workspace });
  }),
);

workspaceRouter.get(
  '/:workspaceId/members',
  requirePermission('members:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json({ members: await listMembers(id) });
  }),
);

workspaceRouter.post(
  '/:workspaceId/members',
  requirePermission('members:invite'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = inviteMemberSchema.parse(req.body);
    const member = await inviteMember(id, userId, email, input, metaOf(req));
    res.status(201).json({ member });
  }),
);

workspaceRouter.patch(
  '/:workspaceId/members/:memberId',
  requirePermission('members:update'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateMemberSchema.parse(req.body);
    const memberId = req.params.memberId;
    const member = await updateMemberRole(
      id,
      userId,
      email,
      typeof memberId === 'string' ? memberId : '',
      input.role,
      metaOf(req),
    );
    res.status(200).json({ member });
  }),
);

workspaceRouter.delete(
  '/:workspaceId/members/:memberId',
  requirePermission('members:remove'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const memberId = req.params.memberId;
    await removeMember(
      id,
      userId,
      email,
      typeof memberId === 'string' ? memberId : '',
      metaOf(req),
    );
    res.status(204).send();
  }),
);

workspaceRouter.post(
  '/:workspaceId/transfer-ownership',
  requirePermission('workspace:transfer'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = transferOwnershipSchema.parse(req.body);
    await transferOwnership(id, userId, email, input.userId, metaOf(req));
    res.status(200).json({ message: 'Ownership transferred.' });
  }),
);
