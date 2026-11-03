import { jest } from '@jest/globals';
import { createAiClient } from '../../src/ai/client.js';
import { AiUnavailableError } from '../../src/ai/errors.js';

const ok = (content = 'hello', usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) => ({
  model: 'gpt-4o-mini-2024-07-18',
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage,
});
const httpError = (status, headers = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, headers: new Headers(headers) });
const timeoutError = () => Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

/** A client wired to a fake SDK, a fake clock and an instant sleep. */
const setup = (overrides = {}) => {
  const create = jest.fn();
  const sleep = jest.fn(async () => {});
  const usage = [];
  let clock = 1_000_000;
  const client = createAiClient({
    sdk: { chat: { completions: { create } } },
    model: 'gpt-4o-mini',
    maxRetries: 2,
    breakerThreshold: 3,
    breakerCooldownMs: 60_000,
    sleep,
    now: () => clock,
    random: () => 0,
    onUsage: (r) => usage.push(r),
    ...overrides,
  });
  return { client, create, sleep, usage, advance: (ms) => (clock += ms) };
};

const call = (client) => client.complete({ feature: 'classify', messages: [{ role: 'user', content: 'hi' }], json: true });

describe('AI client', () => {
  test('success: returns content and usage, sends JSON mode and max_completion_tokens, records usage', async () => {
    const { client, create, usage } = setup();
    create.mockResolvedValue(ok('{"a":1}'));

    const res = await call(client);

    expect(res).toMatchObject({ content: '{"a":1}', attempts: 1, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_completion_tokens: 300,
    });
    expect(usage).toEqual([expect.objectContaining({ feature: 'classify', outcome: 'success', promptTokens: 100, attempts: 1 })]);
  });

  test('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const { client, create, sleep } = setup();
    create.mockRejectedValueOnce(httpError(429)).mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(ok());

    const res = await call(client);

    expect(res.attempts).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]); // 500 × 2^(n-1), jitter fixed at 0
  });

  test('honours Retry-After on 429', async () => {
    const { client, create, sleep } = setup();
    create.mockRejectedValueOnce(httpError(429, { 'retry-after': '2' })).mockResolvedValueOnce(ok());
    await call(client);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  test('timeouts are retried and reported as TIMEOUT when retries run out', async () => {
    const { client, create, usage } = setup();
    create.mockRejectedValue(timeoutError());

    await expect(call(client)).rejects.toMatchObject({ name: 'AiUnavailableError', code: 'TIMEOUT' });
    expect(create).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(usage.at(-1)).toMatchObject({ outcome: 'error', errorCode: 'TIMEOUT', attempts: 3 });
  });

  test('non-retryable errors (400/401) fail immediately', async () => {
    const { client, create, sleep } = setup();
    create.mockRejectedValue(httpError(401));

    await expect(call(client)).rejects.toMatchObject({ code: 'REQUEST_REJECTED', status: 401 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('circuit breaker: opens after 3 failed calls, skips the API while open, half-opens after cooldown, closes on success', async () => {
    const { client, create, usage, advance } = setup({ maxRetries: 0 });
    create.mockRejectedValue(httpError(500));

    for (let i = 0; i < 3; i += 1) await expect(call(client)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(client.status().circuit).toBe('open');
    expect(create).toHaveBeenCalledTimes(3);

    // While open: fails fast without touching the API.
    await expect(call(client)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(create).toHaveBeenCalledTimes(3);
    expect(usage.at(-1)).toMatchObject({ outcome: 'skipped', errorCode: 'CIRCUIT_OPEN' });

    // After the cooldown, one trial call is allowed. Here it fails, so the breaker reopens.
    advance(60_001);
    expect(client.status().circuit).toBe('half-open');
    await expect(call(client)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(client.status().circuit).toBe('open');

    // Next trial succeeds, so the breaker closes and failures reset.
    advance(60_001);
    create.mockResolvedValueOnce(ok());
    await call(client);
    expect(client.status()).toMatchObject({ circuit: 'closed', consecutiveFailures: 0 });
  });

  test('a success resets the consecutive-failure count', async () => {
    const { client, create } = setup({ maxRetries: 0 });
    create.mockRejectedValueOnce(httpError(500)).mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(ok());
    await expect(call(client)).rejects.toThrow();
    await expect(call(client)).rejects.toThrow();
    await call(client);
    expect(client.status()).toMatchObject({ circuit: 'closed', consecutiveFailures: 0 });
  });

  test('without an API key the client is disabled and never calls out', async () => {
    const client = createAiClient({ apiKey: '', onUsage: () => {} });
    expect(client.enabled).toBe(false);
    await expect(call(client)).rejects.toMatchObject({ code: 'AI_DISABLED' });
  });

  test('a failing usage sink never breaks the call', async () => {
    const { client, create } = setup({
      onUsage: () => {
        throw new Error('db down');
      },
    });
    create.mockResolvedValue(ok());
    await expect(call(client)).resolves.toMatchObject({ content: 'hello' });
  });
});
