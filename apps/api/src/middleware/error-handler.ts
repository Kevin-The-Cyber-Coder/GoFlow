import type { ErrorRequestHandler, RequestHandler } from 'express';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
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
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const message =
    isProduction || !(err instanceof Error) ? 'An unexpected error occurred.' : err.message;

  if (!isProduction) {
    console.error(err);
  }

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
  };

  res.status(500).json(body);
};
