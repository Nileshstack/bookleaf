/**
 * QA phase 2: graceful degradation against the real server process.
 *
 *   npm run qa:degradation
 *
 * Boots `node src/server.js` three times on an in-memory MongoDB, each with
 * a broken AI upstream, and drives it over HTTP like the UI does:
 *   a) invalid API key against the real OpenAI API (401, not retried)
 *   b) timeout: OPENAI_BASE_URL points at a local server that never answers
 *   c) rate limit: a local server that always answers 429 with Retry-After
 *
 * Each scenario must show: ticket 201 without waiting for AI, aiStatus
 * 'failed' with a rule-based category/priority, draft 503 AI_UNAVAILABLE
 * with a template, the circuit breaker opening (fast failures, /health
 * "degraded"), manual replies still working, and the process still alive.
 *
 * The real key in server/.env is never read or changed: scenarios set their
 * own OPENAI_API_KEY in the child environment, which dotenv does not override.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';

const SERVER_DIR = new URL('..', import.meta.url);
const FAKE_KEY = 'sk-qa-invalid-key-0000000000000000000000';

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** A stand-in for api.openai.com that hangs or rate-limits every request. */
const fakeUpstream = async (mode) => {
  const sockets = new Set();
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    if (mode === 'hang') return; // never answer: the client's timeout must fire
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    res.end(JSON.stringify({ error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' } }));
  });
  server.on('connection', (s) => sockets.add(s));
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => requests,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
};

const SCENARIOS = [
  { name: 'a) invalid OPENAI_API_KEY (real OpenAI, 401)', env: {} },
  { name: 'b) upstream timeout (AI_TIMEOUT_MS=1500)', upstream: 'hang', env: { AI_TIMEOUT_MS: '1500' } },
  { name: 'c) upstream 429 rate limit (Retry-After: 1)', upstream: '429', env: {} },
];

const mongod = await MongoMemoryServer.create();
const results = [];

for (const [i, scenario] of SCENARIOS.entries()) {
  const upstream = scenario.upstream ? await fakeUpstream(scenario.upstream) : null;
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    MONGODB_URI: mongod.getUri(`bookleaf_degradation_${i}`),
    JWT_SECRET: 'degradation-only-secret-long-enough-32chars',
    CLIENT_URL: 'http://localhost:3000',
    OPENAI_API_KEY: FAKE_KEY,
    AI_CLASSIFY_ON_CREATE: 'true',
    ...scenario.env,
  };
  if (upstream) env.OPENAI_BASE_URL = upstream.url;
  else delete env.OPENAI_BASE_URL;

  const seeded = spawnSync(process.execPath, ['src/seed/seed.js'], { cwd: SERVER_DIR, env, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

  let logs = '';
  let exited = null;
  const child = spawn(process.execPath, ['src/server.js'], { cwd: SERVER_DIR, env });
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  child.on('exit', (code) => (exited = code));

  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = async (method, path, { token, body } = {}) => {
    const started = Date.now();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null), ms: Date.now() - started };
  };
  for (let t = 0; t < 100; t += 1) {
    if ((await fetch(`${base}/health`).catch(() => null))?.ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.data.token;
  const admin = await login('admin@bookleaf.com', 'Admin@123');
  const priya = await login('priya.sharma@email.com', 'Author@123');

  const checks = [];
  const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

  // 1. Ticket creation never waits for AI.
  const created = await call('POST', '/tickets', {
    token: priya,
    body: { bookId: 'BK001', subject: 'Royalty not received', description: 'I have not received my royalty for Whispers of the Ganges this quarter. Please check.' },
  });
  const ref = created.body?.data?.ticketNumber;
  check('ticket created: 201', created.status === 201, `${created.status} in ${created.ms} ms`);
  check('creation did not wait for AI (< 1 s)', created.ms < 1000, `${created.ms} ms`);

  // 2. Background classification fails over to the keyword rules.
  let ticket;
  for (let t = 0; t < 150; t += 1) {
    ticket = (await call('GET', `/admin/tickets/${ref}`, { token: admin })).body?.data;
    if (ticket?.aiStatus !== 'pending') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check("aiStatus = 'failed'", ticket?.aiStatus === 'failed', ticket?.aiStatus);
  check("classificationSource = 'rules'", ticket?.classificationSource === 'rules', ticket?.classificationSource);
  check('rule fallback set category + priority', ticket?.category === 'Royalty & Payments' && Boolean(ticket?.priority), `${ticket?.category} / ${ticket?.priority}`);

  // 3. Draft: 503 with a usable template.
  const draft = await call('POST', `/admin/tickets/${ref}/draft`, { token: admin });
  check('draft: 503 AI_UNAVAILABLE', draft.status === 503 && draft.body?.error?.code === 'AI_UNAVAILABLE', `${draft.status} ${draft.body?.error?.code} reason=${draft.body?.error?.reason} in ${draft.ms} ms`);
  check('draft: fallback template for the admin', /^Hi Priya,[\s\S]*Team BookLeaf$/.test(draft.body?.error?.fallback?.template ?? ''));
  check('draft: no stack trace in the error', !JSON.stringify(draft.body).includes('    at '));

  // 4. The breaker opens (3 failures: classification + 2 drafts), then fails fast.
  await call('POST', `/admin/tickets/${ref}/draft?regenerate=true`, { token: admin });
  const usage = await call('GET', '/admin/ai/usage', { token: admin });
  check('circuit breaker open after 3 failures', usage.body?.data?.client?.circuit === 'open', usage.body?.data?.client?.circuit);
  const health = await call('GET', '/health');
  check('/health reports ai "degraded"', health.body?.data?.services?.ai === 'degraded' || JSON.stringify(health.body).includes('"ai":"degraded"'), JSON.stringify(health.body?.data?.services ?? health.body?.data));
  const upstreamBefore = upstream?.requests();
  const fast = await call('POST', `/admin/tickets/${ref}/draft?regenerate=true`, { token: admin });
  check('open breaker fails fast (< 300 ms, no upstream call)', fast.status === 503 && fast.ms < 300 && (upstream ? upstream.requests() === upstreamBefore : true), `${fast.status} reason=${fast.body?.error?.reason} in ${fast.ms} ms`);

  // 5. Support keeps working without AI.
  const reply = await call('POST', `/admin/tickets/${ref}/reply`, { token: admin, body: { body: 'Hi Priya, we are checking this and will update you within 48 hours.\n\nWarm regards,\nTeam BookLeaf' } });
  check('manual admin reply still works: 201', reply.status === 201, String(reply.status));
  const another = await call('POST', '/tickets', { token: priya, body: { subject: 'Author bio', description: 'Can I update my author bio on Amazon?' } });
  check('more tickets still accepted while AI is down', another.status === 201, `${another.status} in ${another.ms} ms`);
  check('process still alive', exited === null && (await call('GET', '/health')).status === 200);
  check('API key never logged', !logs.includes(FAKE_KEY) && !logs.includes(process.env.OPENAI_API_KEY ?? '\u0000'));
  if (upstream) check('upstream was retried (attempts > 1 per call)', upstream.requests() >= 6, `${upstream.requests()} upstream requests`);

  child.kill('SIGTERM');
  await new Promise((r) => (exited !== null ? r() : child.once('exit', r)));
  upstream?.close();
  results.push({ scenario: scenario.name, checks });

  console.log(`\n${scenario.name}`);
  for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
}

await mongod.stop();
await mkdir(new URL('../../qa/', import.meta.url), { recursive: true });
await writeFile(new URL('../../qa/ai-degradation-results.json', import.meta.url), `${JSON.stringify(results, null, 2)}\n`);

const all = results.flatMap((r) => r.checks);
console.log(`\n${all.filter((c) => c.pass).length}/${all.length} degradation checks passed`);
process.exitCode = all.every((c) => c.pass) ? 0 : 1;
