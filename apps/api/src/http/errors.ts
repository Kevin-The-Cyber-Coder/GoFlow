/**
 * Application error type.
 *
 * Every expected failure is raised as an ApiError so the terminal error
 * handler can produce the same JSON envelope for 400s and 500s alike, and so
 * route handlers never need to know about HTTP response shapes.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication is required.'): ApiError {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action.'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(resource = 'Resource'): ApiError {
    return new ApiError(404, 'NOT_FOUND', `${resource} was not found.`);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static tooManyRequests(message = 'Too many requests.'): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
}
