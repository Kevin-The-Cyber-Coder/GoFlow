import { Router, type Response } from 'express';

import type { TokenService } from '../../lib/tokens';
import { validateBody } from '../../middleware/validate';
import { loginSchema, registerSchema } from './schemas';
import type { AuthService, RequestContext, SessionTokens } from './service';

export const REFRESH_COOKIE_NAME = 'goflow_refresh';

/** Scoped to the auth routes so it is never sent with ordinary API calls. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AuthRouterDependencies {
  service: AuthService;
  tokens: TokenService;
  secureCookies: boolean;
}

function setRefreshCookie(res: Response, token: string, ttlSeconds: number, secure: boolean): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: ttlSeconds * 1000,
  });
}

function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: REFRESH_COOKIE_PATH,
  });
}

function requestContext(req: {
  headers: Record<string, unknown>;
  ip?: string | undefined;
}): RequestContext {
  const userAgent =
    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

  return { userAgent, ipAddress: req.ip };
}

function readRefreshCookie(cookies: Record<string, string | undefined>): string | undefined {
  return cookies[REFRESH_COOKIE_NAME];
}

export function createAuthRouter({
  service,
  tokens,
  secureCookies,
}: AuthRouterDependencies): Router {
  const router = Router();

  router.post('/register', validateBody(registerSchema), async (req, res) => {
    const result = await service.register(req.body, requestContext(req));

    setRefreshCookie(
      res,
      result.session.refreshToken,
      tokens.refreshTokenTtlSeconds,
      secureCookies,
    );
    res.status(201).json({
      data: {
        user: result.user,
        workspace: result.workspace,
        accessToken: result.session.accessToken,
      },
    });
  });

  router.post('/login', validateBody(loginSchema), async (req, res) => {
    const result = await service.login(req.body, requestContext(req));

    setRefreshCookie(
      res,
      result.session.refreshToken,
      tokens.refreshTokenTtlSeconds,
      secureCookies,
    );
    res.status(200).json({
      data: {
        user: result.user,
        workspace: result.workspace,
        accessToken: result.session.accessToken,
      },
    });
  });

  router.post('/refresh', async (req, res) => {
    const rawToken = readRefreshCookie(req.cookies as Record<string, string | undefined>);

    if (!rawToken) {
      res.status(401).json({
        error: { code: 'MISSING_REFRESH_TOKEN', message: 'No refresh token was provided.' },
      });
      return;
    }

    const result = await service.refresh(rawToken, requestContext(req));
    const session: SessionTokens = result.session;

    setRefreshCookie(res, session.refreshToken, tokens.refreshTokenTtlSeconds, secureCookies);
    res.status(200).json({
      data: {
        user: result.user,
        workspace: result.workspace,
        accessToken: session.accessToken,
      },
    });
  });

  router.post('/logout', async (req, res) => {
    await service.logout(readRefreshCookie(req.cookies as Record<string, string | undefined>));
    clearRefreshCookie(res, secureCookies);
    res.status(204).send();
  });

  return router;
}
