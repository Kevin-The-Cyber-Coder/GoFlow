import cors, { type CorsOptions } from 'cors';
import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import helmet from 'helmet';

import { ApiError } from '../http/errors';

/** A burst allowance for the API as a whole. */
const API_WINDOW_MS = 60 * 1000;
const API_LIMIT_DEFAULT = 300;

/** Login and registration are guessing surfaces, so they get their own window. */
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LIMIT_DEFAULT = 10;

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name} "${raw}". Expected a positive integer.`);
  }

  return value;
}

/**
 * Rate limiting is disabled under test unless a suite opts in, because every
 * other integration test would otherwise share one IP counter and start
 * failing partway through the run.
 */
function rateLimitingEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' || process.env.RATE_LIMIT_ENABLED === '1';
}

/**
 * Browser origins allowed to call the API, from a comma-separated
 * `CORS_ORIGINS`. An empty list means no cross-origin browser access at all.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Helmet's defaults, which cover the headers that matter for a JSON API:
 * `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
 * `Strict-Transport-Security` and an empty-resource CSP.
 */
export function securityHeaders(): RequestHandler {
  return helmet();
}

/**
 * CORS with an explicit allowlist.
 *
 * A request without an `Origin` header (curl, another service, the same
 * origin) is not a browser cross-origin request, so it is left alone.
 * Everything else must match `CORS_ORIGINS` exactly; an unlisted origin gets
 * no CORS headers, which is what makes the browser refuse the response.
 */
export function corsMiddleware(): RequestHandler {
  const allowed = allowedOrigins();

  const options: CorsOptions = {
    origin(origin, callback) {
      callback(null, origin === undefined || allowed.includes(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id'],
    // Rate limit headers are informational; expose them so a browser client
    // can back off before it is refused.
    exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
    credentials: false,
  };

  return cors(options);
}

function limiter(options: { windowMs: number; limit: number; message: string }): RequestHandler {
  const config: Partial<Options> = {
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Passing the error to Express keeps the 429 in the same JSON envelope as
    // every other failure instead of express-rate-limit's plain-text body.
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests(options.message));
    },
  };

  return rateLimit(config);
}

/** Applies to every API route except the health check, which is mounted first. */
export function apiRateLimiter(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  if (!rateLimitingEnabled()) {
    return (_req, _res, next) => next();
  }

  return limiter({
    windowMs: API_WINDOW_MS,
    limit: positiveInteger(env.RATE_LIMIT_MAX, API_LIMIT_DEFAULT, 'RATE_LIMIT_MAX'),
    message: 'Too many requests from this address. Slow down and retry in a minute.',
  });
}

/**
 * A stricter limit for authentication endpoints: password guessing needs far
 * more attempts than a normal client makes, so the same budget as the rest of
 * the API would leave it effectively unlimited.
 */
export function authRateLimiter(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  if (!rateLimitingEnabled()) {
    return (_req, _res, next) => next();
  }

  return limiter({
    windowMs: AUTH_WINDOW_MS,
    limit: positiveInteger(env.AUTH_RATE_LIMIT_MAX, AUTH_LIMIT_DEFAULT, 'AUTH_RATE_LIMIT_MAX'),
    message: 'Too many authentication attempts. Try again in a few minutes.',
  });
}
