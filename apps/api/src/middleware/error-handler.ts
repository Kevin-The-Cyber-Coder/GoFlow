import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError } from '../lib/errors';
import type { ValidationIssue } from './validate';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ValidationIssue[];
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
 * Expected failures keep their code and message; anything unexpected becomes a
 * generic 500 and its details never reach the caller in production.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  if (err instanceof AppError) {
    const details = (err as AppError & { issues?: ValidationIssue[] }).issues;
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(details ? { details } : {}),
      },
    };

    res.status(err.status).json(body);
    return;
  }

  if (!isProduction) {
    console.error(err);
  }

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction
        ? 'An unexpected error occurred.'
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred.',
    },
  };

  res.status(500).json(body);
};
