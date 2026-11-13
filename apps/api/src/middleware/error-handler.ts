import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { ApiError } from '../http/errors';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} does not exist.`,
    },
  };

  res.status(404).json(body);
};

/**
 * Terminal error middleware.
 *
 * Every API error is shaped here so clients can rely on one response format.
 * Internal details are never leaked to the caller in production.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request body is invalid.',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    };
    res.status(400).json(body);
    return;
  }

  const message =
    isProduction || !(err instanceof Error) ? 'An unexpected error occurred.' : err.message;

  if (!isProduction) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
  };

  res.status(500).json(body);
};
