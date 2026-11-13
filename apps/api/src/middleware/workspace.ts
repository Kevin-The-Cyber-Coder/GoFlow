import type { RequestHandler } from 'express';
import type { WorkspaceRole } from '@prisma/client';

import { getPrisma } from '../database/client';
import { asyncHandler } from '../http/async-handler';
import { ApiError } from '../http/errors';
import { authContext } from './auth';
import { can, type Permission } from '../modules/workspaces/permissions';

export interface WorkspaceContext {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
}

declare global {
  namespace Express {
    interface Request {
      workspace?: WorkspaceContext;
    }
  }
}

/**
 * Resolves the workspace a request operates on and verifies membership.
 *
 * Resolution order: the `:workspaceId` route parameter, then the
 * `X-Workspace-Id` header, then the user's first membership. A membership is
 * required in every case, so a forged workspace id can never widen access —
 * it only narrows it to a workspace the user already belongs to.
 */
export const resolveWorkspace: RequestHandler = asyncHandler(async (req, _res, next) => {
  const { userId } = authContext(req);
  const paramId = req.params.workspaceId;
  const headerId = req.header('x-workspace-id');
  const requestedId = typeof paramId === 'string' ? paramId : headerId;

  const membership =
    requestedId === undefined
      ? await getPrisma().workspaceMember.findFirst({
          where: { userId, workspace: { deletedAt: null } },
          orderBy: { invitedAt: 'asc' },
          include: { workspace: true },
        })
      : await getPrisma().workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: requestedId, userId } },
          include: { workspace: true },
        });

  if (membership === null || membership.workspace.deletedAt !== null) {
    // 404 rather than 403: telling an attacker that a workspace exists but
    // they are not a member of it leaks tenant existence.
    throw ApiError.notFound('Workspace');
  }

  req.workspace = {
    id: membership.workspaceId,
    role: membership.role,
    userId,
  };

  next();
});

export function workspaceContext(req: { workspace?: WorkspaceContext }): WorkspaceContext {
  if (req.workspace === undefined) {
    throw ApiError.unauthorized('A workspace context is required.');
  }
  return req.workspace;
}

/** Enforces a single permission from the role matrix. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const context = workspaceContext(req);
    if (!can(context.role, permission)) {
      next(
        ApiError.forbidden(
          `Your role (${context.role}) does not allow "${permission}" in this workspace.`,
        ),
      );
      return;
    }
    next();
  };
}
