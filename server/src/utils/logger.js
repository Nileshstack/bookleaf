import { env } from '../config/env.js';

/**
 * Minimal structured logger. Kept dependency-free for now; the interface
 * (info/warn/error with a context object) makes swapping in pino trivial.
 */
const write = (level, message, context = {}) => {
  // Tests deliberately trigger 4xx responses; only real errors are worth printing there.
  if (env.isTest && level !== 'error') return;

  const entry = { level, time: new Date().toISOString(), message, ...context };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const logger = {
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
};
