import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AiUnavailableError } from './errors.js';

/**
 * The only module that talks to OpenAI. Everything else goes through
 * aiClient.complete(). That keeps the following in one place:
 *  - per-request timeout
 *  - retries with exponential backoff + jitter on 429 / 5xx / network
 *    errors, honouring Retry-After
 *  - a circuit breaker: after N consecutive failed calls, AI calls are
 *    skipped for a cooldown period instead of making every request wait
 *    for a dead upstream
 *  - usage reporting (tokens, latency, outcome) for every call, success
 *    or failure
 *
 * createAiClient() takes its dependencies as arguments, so unit tests can
 * drive it with a fake SDK and a fake clock, with no network and no waiting.
 */

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5_000;

const RETRYABLE_STATUS = new Set([408, 409, 429]);
const NETWORK_ERRORS = new Set(['APIConnectionError', 'APIConnectionTimeoutError']);

// The SDK's error classes don't set `name` (it stays "Error"), so go by the class.
const errorKind = (err) => (err?.name && err.name !== 'Error' ? err.name : err?.constructor?.name);
const isTimeout = (err) => ['APIConnectionTimeoutError', 'AbortError'].includes(errorKind(err));
const isRetryable = (err) =>
  NETWORK_ERRORS.has(errorKind(err)) || RETRYABLE_STATUS.has(err?.status) || (err?.status ?? 0) >= 500;

const codeFor = (err) => {
  if (isTimeout(err)) return 'TIMEOUT';
  if (err?.status === 429) return 'RATE_LIMITED';
  if (isRetryable(err)) return 'UPSTREAM_ERROR';
  return 'REQUEST_REJECTED'; // 400/401/403/404: retrying won't help (bad request, bad key, unknown model)
};

const retryAfterMs = (err) => {
  const header = err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after'];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_BACKOFF_MS) : null;
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createAiClient = ({
  apiKey = env.openai.apiKey,
  model = env.openai.model,
  timeoutMs = env.ai.timeoutMs,
  maxRetries = env.ai.maxRetries,
  breakerThreshold = env.ai.breakerThreshold,
  breakerCooldownMs = env.ai.breakerCooldownMs,
  sdk, // injected fake in tests
  onUsage = () => {}, // receives one record per call
  sleep = defaultSleep,
  now = () => Date.now(),
  random = Math.random,
} = {}) => {
  const enabled = Boolean(apiKey) || Boolean(sdk);
  // The SDK's own retries are off (maxRetries: 0); we retry ourselves so the
  // policy is visible, testable and feeds the circuit breaker.
  const openai = sdk ?? (enabled ? new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 }) : null);

  const breaker = { consecutiveFailures: 0, openUntil: 0 };

  const breakerState = () => {
    if (breaker.openUntil === 0) return 'closed';
    return now() < breaker.openUntil ? 'open' : 'half-open'; // half-open: the next call is a trial
  };

  const recordFailure = () => {
    breaker.consecutiveFailures += 1;
    if (breaker.consecutiveFailures >= breakerThreshold) {
      breaker.openUntil = now() + breakerCooldownMs;
      logger.warn('AI circuit breaker opened', { failures: breaker.consecutiveFailures, cooldownMs: breakerCooldownMs });
    }
  };

  const recordSuccess = () => {
    if (breaker.openUntil !== 0) logger.info('AI circuit breaker closed');
    breaker.consecutiveFailures = 0;
    breaker.openUntil = 0;
  };

  const backoffMs = (attempt, err) =>
    retryAfterMs(err) ?? Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(random() * 250), MAX_BACKOFF_MS);

  /**
   * One logical completion (up to 1 + maxRetries HTTP attempts).
   * Interactive callers can ask for a shorter budget (`retries`, `timeout`);
   * neither can exceed the configured limits.
   * Resolves { content, usage, model, latencyMs, attempts }; rejects with AiUnavailableError.
   */
  const complete = async ({ feature, messages, temperature = 0, maxTokens = 300, json = false, ticketId, retries, timeout }) => {
    const callRetries = Math.min(retries ?? maxRetries, maxRetries);
    const callTimeout = Math.min(timeout ?? timeoutMs, timeoutMs);
    const report = (record) => {
      try {
        onUsage({ feature, model, ticketId, ...record });
      } catch (err) {
        logger.warn('AI usage reporting failed', { error: err.message }); // never fail a call over bookkeeping
      }
    };

    if (!enabled) {
      report({ outcome: 'skipped', errorCode: 'AI_DISABLED' });
      throw new AiUnavailableError('AI is not configured (OPENAI_API_KEY is empty)', { code: 'AI_DISABLED' });
    }
    if (breakerState() === 'open') {
      report({ outcome: 'skipped', errorCode: 'CIRCUIT_OPEN' });
      throw new AiUnavailableError('AI temporarily paused after repeated failures', { code: 'CIRCUIT_OPEN' });
    }

    const started = now();
    let lastError;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= callRetries + 1; attempt += 1) {
      attemptsMade = attempt;
      try {
        const response = await openai.chat.completions.create(
          {
            model,
            messages,
            temperature,
            max_completion_tokens: maxTokens,
            ...(json && { response_format: { type: 'json_object' } }),
          },
          { timeout: callTimeout },
        );

        const usage = {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
          cachedPromptTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        };
        const latencyMs = now() - started;
        recordSuccess();
        report({ outcome: 'success', ...usage, latencyMs, attempts: attempt, finishReason: response.choices?.[0]?.finish_reason });

        return {
          content: response.choices?.[0]?.message?.content ?? '',
          finishReason: response.choices?.[0]?.finish_reason,
          usage,
          model: response.model ?? model,
          latencyMs,
          attempts: attempt,
        };
      } catch (err) {
        lastError = err;
        const canRetry = isRetryable(err) && attempt <= callRetries;
        logger.warn('AI request failed', { feature, attempt, status: err?.status, error: err?.message, willRetry: canRetry });
        if (!canRetry) break;
        await sleep(backoffMs(attempt, lastError));
      }
    }

    recordFailure();
    const code = codeFor(lastError);
    report({ outcome: 'error', errorCode: code, latencyMs: now() - started, attempts: attemptsMade });
    throw new AiUnavailableError(`AI request failed: ${lastError?.message ?? 'unknown error'}`, {
      code,
      status: lastError?.status,
      cause: lastError,
    });
  };

  return {
    complete,
    model,
    get enabled() {
      return enabled;
    },
    status: () => ({
      enabled,
      model,
      circuit: breakerState(),
      consecutiveFailures: breaker.consecutiveFailures,
      openUntil: breaker.openUntil ? new Date(breaker.openUntil).toISOString() : null,
    }),
  };
};
