import { env } from './env.js';
import { AppError } from '../utils/AppError.js';

export const corsOptions = {
  origin(origin, callback) {
    // No Origin header = same-origin, curl, health checks, server-to-server.
    if (!origin || env.clientUrls.includes(origin)) return callback(null, true);
    return callback(AppError.forbidden(`Origin ${origin} is not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
  maxAge: 600,
};
