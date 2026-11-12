import type { Request, RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';

import { AppError } from '../lib/errors';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function validationError(error: ZodError): AppError {
  const issues = toValidationIssues(error);
  const appError = new AppError(
    400,
    'VALIDATION_ERROR',
    `Request validation failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
  );

  return Object.assign(appError, { issues });
}

/**
 * Replaces `req.body` with the parsed value only when validation succeeds.
 * Handlers can then trust the shape instead of re-checking it.
 */
export function validateBody<TOutput>(schema: ZodType<TOutput>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(validationError(result.error));
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Parses the query string without assigning back to `req.query`: Express 5
 * defines it as a read-only getter, so validated values are returned instead.
 */
export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.query);

  if (!result.success) {
    throw validationError(result.error);
  }

  return result.data;
}
