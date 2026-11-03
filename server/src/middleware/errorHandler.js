import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Translates known library errors into AppErrors so every failure leaves the
 * API in the same shape. Returns null for errors we don't recognise.
 */
const normalize = (err) => {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return AppError.validation(
      err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return AppError.validation(
      Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return AppError.badRequest(`Invalid value for "${err.path}"`);
  }

  if (err?.code === 11000) {
    const fields = Object.keys(err.keyValue ?? {});
    return AppError.conflict(
      `Duplicate value for ${fields.join(', ') || 'a unique field'}`,
      fields.map((field) => ({ field, message: 'Already in use' })),
    );
  }

  if (err?.name === 'TokenExpiredError') return AppError.unauthorized('Session expired, please log in again');
  if (err?.name === 'JsonWebTokenError') return AppError.unauthorized('Invalid authentication token');

  // Raised by express.json() body parsing.
  if (err?.type === 'entity.parse.failed') return AppError.badRequest('Malformed JSON in request body');
  if (err?.type === 'entity.too.large') {
    return new AppError('Request body is too large', { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
  }

  return null;
};

export const notFoundHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl}`));
};

// Express identifies error middleware by its 4-argument signature.
export const errorHandler = (err, req, res, _next) => {
  const known = normalize(err);
  const error = known ?? new AppError('Something went wrong on our side. Please try again.', {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
  });

  const logContext = { requestId: req.id, method: req.method, path: req.originalUrl, code: error.code };
  if (error.statusCode >= 500) {
    logger.error(err.message, { ...logContext, stack: err.stack });
  } else {
    logger.warn(error.message, logContext);
  }

  res.status(error.statusCode).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      // Always an array so clients can iterate without null checks.
      details: Array.isArray(error.details) ? error.details : [],
      requestId: req.id,
      // Raw messages of unexpected errors help locally but must never leak in production.
      ...(!known && !env.isProd && { debug: err.message }),
    },
  });
};
