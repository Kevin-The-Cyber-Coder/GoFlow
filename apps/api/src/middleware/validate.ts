import type { RequestHandler } from 'express';
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

/**
 * Replaces `req.body` with the parsed value only when validation succeeds.
 * Handlers can then trust the shape instead of re-checking it.
 */
export function validateBody<TOutput>(schema: ZodType<TOutput>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issues = toValidationIssues(result.error);
      const error = new AppError(
        400,
        'VALIDATION_ERROR',
        `Request validation failed: ${issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join('; ')}`,
      );

      next(Object.assign(error, { issues }));
      return;
    }

    req.body = result.data;
    next();
  };
}
