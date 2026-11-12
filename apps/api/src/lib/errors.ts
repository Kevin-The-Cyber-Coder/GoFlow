/**
 * Errors that are safe to expose to API clients.
 *
 * Anything else that reaches the error middleware is treated as an internal
 * failure and its message is hidden in production (see middleware/error-handler).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST'): AppError =>
  new AppError(400, code, message);

export const unauthorized = (
  message = 'Authentication required.',
  code = 'UNAUTHORIZED',
): AppError => new AppError(401, code, message);

export const forbidden = (message = 'You do not have access to this resource.'): AppError =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found.'): AppError =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code = 'CONFLICT'): AppError =>
  new AppError(409, code, message);
