import type { RequestHandler } from 'express';

/**
 * Express 5 forwards rejected promises, but wrapping keeps handlers explicit
 * and works identically for middleware that returns a value.
 */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
