import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { closeAccountSchema, updateProfileSchema } from './schemas';
import { closeAccount, updateProfile } from './service';

export const userRouter: Router = Router();

function contextOf(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

userRouter.use(requireAuth);

userRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    const input = updateProfileSchema.parse(req.body);
    res.status(200).json(await updateProfile(userId, input, contextOf(req)));
  }),
);

userRouter.delete(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    const input = closeAccountSchema.parse(req.body);
    await closeAccount(userId, input.password, contextOf(req));
    res.status(204).send();
  }),
);
