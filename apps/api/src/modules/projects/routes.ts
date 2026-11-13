import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import { createProjectSchema, listProjectsSchema, updateProjectSchema } from './schemas';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  setProjectArchived,
  updateProject,
} from './service';

export const projectRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

projectRouter.use(requireAuth, resolveWorkspace);

projectRouter.get(
  '/',
  requirePermission('projects:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json(await listProjects(id, listProjectsSchema.parse(req.query)));
  }),
);

projectRouter.post(
  '/',
  requirePermission('projects:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createProjectSchema.parse(req.body);
    res.status(201).json({ project: await createProject(id, userId, email, input, metaOf(req)) });
  }),
);

projectRouter.get(
  '/:projectId',
  requirePermission('projects:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json({ project: await getProject(id, param(req, 'projectId')) });
  }),
);

projectRouter.patch(
  '/:projectId',
  requirePermission('projects:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateProjectSchema.parse(req.body);
    const project = await updateProject(
      id,
      userId,
      email,
      param(req, 'projectId'),
      input,
      metaOf(req),
    );
    res.status(200).json({ project });
  }),
);

projectRouter.post(
  '/:projectId/archive',
  requirePermission('projects:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const project = await setProjectArchived(
      id,
      userId,
      email,
      param(req, 'projectId'),
      true,
      metaOf(req),
    );
    res.status(200).json({ project });
  }),
);

projectRouter.post(
  '/:projectId/restore',
  requirePermission('projects:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const project = await setProjectArchived(
      id,
      userId,
      email,
      param(req, 'projectId'),
      false,
      metaOf(req),
    );
    res.status(200).json({ project });
  }),
);

projectRouter.delete(
  '/:projectId',
  requirePermission('projects:delete'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    await deleteProject(id, userId, email, param(req, 'projectId'), metaOf(req));
    res.status(204).send();
  }),
);
