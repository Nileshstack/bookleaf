/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Anything thrown as an AppError is considered safe to show to the client;
 * anything else is treated as a bug and its details are hidden.
 */
export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details, extra } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Additional machine-readable fields merged into the error body, e.g. a
    // fallback template when the AI is unavailable.
    this.extra = extra;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message = 'Bad request', details) {
    return new AppError(message, { statusCode: 400, code: 'BAD_REQUEST', details });
  }

  /**
   * 422 for a well-formed body whose values are invalid; pass statusCode 400
   * when the URL itself (params / query) is malformed.
   */
  static validation(details, { message = 'Validation failed', statusCode = 422 } = {}) {
    return new AppError(message, { statusCode, code: 'VALIDATION_ERROR', details });
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(message, { statusCode: 403, code: 'FORBIDDEN' });
  }

  static notFound(resource = 'Resource') {
    return new AppError(`${resource} not found`, { statusCode: 404, code: 'NOT_FOUND' });
  }

  static conflict(message = 'Resource already exists', details) {
    return new AppError(message, { statusCode: 409, code: 'CONFLICT', details });
  }

  static tooManyRequests(message = 'Too many requests, please try again later') {
    return new AppError(message, { statusCode: 429, code: 'RATE_LIMITED' });
  }

  static serviceUnavailable(message = 'Service temporarily unavailable') {
    return new AppError(message, { statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
  }
}
