import type { RequestHandler } from 'express';

import { loadAuthConfig } from '../config/auth';
import { ApiError } from '../http/errors';
import { verifyAccessToken } from '../modules/auth/tokens';

/**
 * Verifies the bearer access token and attaches its identity to the request.
 * Authorization (what the identity may do) is a separate concern handled by
 * the workspace guards.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (header === undefined || !header.startsWith('Bearer ')) {
    next(ApiError.unauthorized('Provide a Bearer access token.'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    next(ApiError.unauthorized('The access token is empty.'));
    return;
  }

  try {
    req.auth = verifyAccessToken(token, loadAuthConfig());
    next();
  } catch (error) {
    next(error);
  }
};

/** Narrowing helper for handlers mounted behind `requireAuth`. */
export function authContext(req: { auth?: { userId: string; email: string } }): {
  userId: string;
  email: string;
} {
  if (req.auth === undefined) {
    throw ApiError.unauthorized();
  }
  return req.auth;
}
