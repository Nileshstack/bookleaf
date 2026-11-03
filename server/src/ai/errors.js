/**
 * The AI layer throws only these two errors, so callers can always tell
 * "the AI wasn't reachable" apart from "the AI answered with junk".
 * Callers degrade on either one; neither should surface as a raw 500.
 */

/** The model couldn't be reached or refused: disabled, circuit open, timeout, rate limit, 5xx. */
export class AiUnavailableError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message, { cause });
    this.name = 'AiUnavailableError';
    this.code = code; // AI_DISABLED | CIRCUIT_OPEN | TIMEOUT | RATE_LIMITED | UPSTREAM_ERROR | REQUEST_REJECTED
    this.status = status;
  }
}

/** The model answered, but the output failed validation (bad JSON, unknown category, ...). */
export class AiOutputError extends Error {
  constructor(message, { raw } = {}) {
    super(message);
    this.name = 'AiOutputError';
    this.code = 'INVALID_OUTPUT';
    this.raw = typeof raw === 'string' ? raw.slice(0, 500) : raw; // kept short for logs
  }
}
