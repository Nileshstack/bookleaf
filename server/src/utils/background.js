import { logger } from './logger.js';

/**
 * Fire-and-forget: runs fn after the current request has finished and never
 * lets its failure (sync throw or rejection) reach the caller or crash the
 * process. For side effects like AI classification that must not decide
 * whether the user's request succeeds.
 *
 * In-process on purpose: fine for one instance. A durable queue (BullMQ,
 * SQS) would replace this when the API is scaled out or work must survive
 * restarts. Tickets left with aiStatus 'pending' are recoverable either way.
 */
export const runInBackground = (taskName, fn, context = {}) => {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .catch((err) => logger.error(`Background task failed: ${taskName}`, { ...context, error: err?.message }));
  });
};
