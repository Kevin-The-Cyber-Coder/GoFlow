import { Router } from 'express';

import { unauthorized } from '../../lib/errors';
import type { TokenService } from '../../lib/tokens';
import { authenticate } from '../../middleware/authenticate';
import type { AuthService } from '../auth/service';

export interface UsersRouterDependencies {
  authService: AuthService;
  tokens: TokenService;
}

export function createUsersRouter({ authService, tokens }: UsersRouterDependencies): Router {
  const router = Router();

  router.get('/me', authenticate(tokens), async (req, res) => {
    const userId = req.auth?.userId;

    if (!userId) {
      throw unauthorized();
    }

    const profile = await authService.getProfile(userId);

    res.status(200).json({ data: profile });
  });

  return router;
}
