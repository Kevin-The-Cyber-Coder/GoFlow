import cors, { type CorsOptions } from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';

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
    maxAge: 600,
    credentials: false,
  };

  return cors(options);
}
