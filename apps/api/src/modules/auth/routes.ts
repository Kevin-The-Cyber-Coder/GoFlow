import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema } from './schemas';
import {
  changePassword,
  getProfile,
  listSessions,
  login,
  logout,
  logoutAll,
  refreshSession,
  register,
  revokeSession,
} from './service';

export const authRouter: Router = Router();

function contextOf(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await register(input, contextOf(req));
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const tokens = await login(input, contextOf(req));
    res.status(200).json(tokens);
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const input = refreshSchema.parse(req.body);
    const tokens = await refreshSession(input.refreshToken, contextOf(req));
    res.status(200).json(tokens);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const input = refreshSchema.parse(req.body);
    await logout(input.refreshToken);
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    res.status(200).json(await getProfile(userId));
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    const revoked = await logoutAll(userId);
    res.status(200).json({ revokedSessions: revoked });
  }),
);

authRouter.patch(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    const input = changePasswordSchema.parse(req.body);
    await changePassword(userId, input.currentPassword, input.newPassword, contextOf(req));
    res.status(200).json({ message: 'Password updated. All sessions were signed out.' });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    res.status(200).json({ sessions: await listSessions(userId) });
  }),
);

authRouter.delete(
  '/sessions/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);
    const sessionId = req.params.sessionId;
    await revokeSession(userId, typeof sessionId === 'string' ? sessionId : '');
    res.status(204).send();
  }),
);
