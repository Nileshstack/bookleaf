/**
 * Self-contained API for the Playwright UI suite (client/e2e):
 *
 *   node scripts/e2e-stack.js      # API on :5100, fake OpenAI on :5199
 *
 * - In-memory MongoDB seeded with the provided dataset (your real database
 *   and real OpenAI key are never used).
 * - A fake OpenAI upstream, reached through the real SDK via OPENAI_BASE_URL:
 *   classifications come from the keyword rules, drafts are a short fixed
 *   reply, so UI tests are deterministic and free.
 * - POST http://127.0.0.1:5199/__qa/mode {"mode":"down"} makes the upstream
 *   answer 401 like a revoked key; {"mode":"up"} restores it. The breaker
 *   cooldown is 2 s here so tests recover quickly.
 */
import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

const API_PORT = Number(process.env.E2E_API_PORT ?? 5100);
const AI_PORT = Number(process.env.E2E_AI_PORT ?? 5199);

const mongod = await MongoMemoryServer.create();
Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  MONGODB_URI: mongod.getUri('bookleaf_ui_e2e'),
  JWT_SECRET: 'ui-e2e-only-secret-that-is-long-enough-32',
  CLIENT_URL: 'http://localhost:3100,http://127.0.0.1:3100',
  OPENAI_API_KEY: 'sk-e2e-fake-key-not-real-000000000000',
  OPENAI_BASE_URL: `http://127.0.0.1:${AI_PORT}/v1`,
  AI_CLASSIFY_ON_CREATE: 'true',
  AI_MAX_RETRIES: '0',
  AI_BREAKER_COOLDOWN_MS: '2000',
  RATE_LIMIT_MAX: '100000',
});

const { classifyWithRules } = await import('../src/ai/fallbackClassifier.js');
const { seedDatabase } = await import('../src/seed/seed.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');

let mode = 'up';
const completion = (content) => ({
  id: 'chatcmpl-e2e',
  object: 'chat.completion',
  model: 'gpt-4o-mini-e2e',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 500, completion_tokens: 60, total_tokens: 560 },
});

createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.url === '/__qa/mode') {
    mode = JSON.parse(raw || '{}').mode === 'down' ? 'down' : 'up';
    return send(200, { mode });
  }
  if (mode === 'down') {
    return send(401, { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } });
  }

  const body = JSON.parse(raw);
  const user = body.messages.at(-1).content;
  // Slow enough for the queue shimmer and the draft loading state to be observable.
  await new Promise((r) => setTimeout(r, body.response_format ? 2000 : 600));

  if (body.response_format) {
    const subject = user.match(/SUBJECT: (.*)/)?.[1] ?? '';
    const description = user.match(/"""\n([\s\S]*?)\n"""/)?.[1] ?? '';
    // Same signals the real model gets from ACCOUNT CONTEXT (e.g. never paid → Critical).
    const book = JSON.parse(user.match(/ACCOUNT CONTEXT: (.*)/)?.[1] ?? '{}').book ?? {};
    const paidMonths = Number.isFinite(book.months_since_last_payout) ? book.months_since_last_payout : null;
    const { category, priority } = classifyWithRules(
      { subject, description },
      { monthsSinceLastPayout: paidMonths, monthsSincePublication: book.months_since_publication ?? null },
    );
    return send(200, completion(JSON.stringify({ category, priority, reasoning: 'E2E fake model: keyword match.', confidence: 0.9 })));
  }
  const firstName = user.match(/address them as "([^"]+)"/)?.[1] ?? 'there';
  return send(
    200,
    completion(`Hi ${firstName},\n\nThank you for reaching out. We have looked into this and will update you within 48 hours.\n\nWarm regards,\nTeam BookLeaf`),
  );
}).listen(AI_PORT, '127.0.0.1');

await connectDB();
await seedDatabase({ log: () => {} });
await disconnectDB(); // src/server.js opens its own connection
await import('../src/server.js');

const stop = async () => {
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
