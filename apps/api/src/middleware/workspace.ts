import type { Request, RequestHandler } from 'express';

import type { Database } from '../db/client';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors';
import { isUuid } from '../lib/ids';
import { findMembership } from '../modules/workspaces/repository';

/**
 * Resolves which workspace the request operates on.
 *
 * Must run after `authenticate`. The workspace can be selected with the
 * `X-Workspace-Id` header; otherwise the caller's oldest membership is used.
 * A workspace the caller does not belong to is reported as 403 and never leaks
 * whether it exists.
 */
export function requireWorkspace(db: Database): RequestHandler {
  return async (req, _res, next) => {
    try {
      const userId = req.auth?.userId;

      if (!userId) {
        throw unauthorized();
      }

      const header = req.headers['x-workspace-id'];

      if (header !== undefined && typeof header !== 'string') {
        throw badRequest('X-Workspace-Id must be a single value.', 'INVALID_WORKSPACE_HEADER');
      }

      if (header !== undefined && !isUuid(header)) {
        throw badRequest('X-Workspace-Id must be a UUID.', 'INVALID_WORKSPACE_HEADER');
      }

      const membership = await findMembership(db, userId, header);

      if (!membership) {
        throw forbidden('You do not have access to this workspace.');
      }

      req.workspace = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Fails loudly if a route used the workspace context without the middleware. */
export function workspaceIdOf(req: Request): string {
  if (!req.workspace) {
    throw new AppError(500, 'WORKSPACE_CONTEXT_MISSING', 'Workspace context was not resolved.');
  }

  return req.workspace.workspaceId;
}
