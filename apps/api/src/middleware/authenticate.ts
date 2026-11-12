import type { RequestHandler } from 'express';

import { unauthorized } from '../lib/errors';
import type { TokenService } from '../lib/tokens';

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies the access token and attaches the caller's identity to the request.
 * It deliberately does not load the user: authorisation decisions belong to the
 * services, and a token for a deleted user must fail there with a 401.
 */
export function authenticate(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      next(unauthorized('Missing bearer token.', 'MISSING_TOKEN'));
      return;
    }

    try {
      const { userId } = await tokens.verifyAccessToken(header.slice(BEARER_PREFIX.length).trim());
      req.auth = { userId };
      next();
    } catch (error) {
      next(error);
    }
  };
}
