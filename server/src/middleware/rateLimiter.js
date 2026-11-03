import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Route the 429 through the central error handler so it has the standard shape.
const handler = (_req, _res, next, options) => next(AppError.tooManyRequests(options.message));

/** Broad per-IP ceiling for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many requests, please slow down and try again shortly',
  handler,
});

/** Tight limit for credential endpoints to slow down password guessing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again in 15 minutes',
  handler,
});

/**
 * Per-author cap on new tickets. Every ticket triggers a paid AI call, so
 * this stops a buggy client or abusive account from running up the bill.
 * Keyed by user, not IP: runs after authenticate.
 */
export const ticketCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `ticket-create:${req.user.id}`,
  message: "You've opened a lot of tickets in the last hour. Please add details to an existing ticket, or try again later",
  handler,
});

/**
 * Guards endpoints that call the LLM. Each call costs money, so this is
 * deliberately stricter than the general API limit.
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'AI request limit reached, please wait a minute',
  handler,
});
