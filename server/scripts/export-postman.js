/**
 * Generates a Postman v2.1 collection from the OpenAPI spec, so the two
 * can't drift: `npm run docs:postman`.
 *
 * - One folder per tag; the "Login as …" requests store the JWT in the
 *   {{token}} collection variable, and every request sends it as Bearer.
 * - Path params become {{ticketId}} / {{bookId}} variables with seeded defaults.
 * - SSE endpoints are included for reference; Postman shows the event stream.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { openApiSpec } from '../src/docs/openapi.js';

const OUT = new URL('../../docs/postman/BookLeaf.postman_collection.json', import.meta.url);

const saveToken = {
  listen: 'test',
  script: {
    type: 'text/javascript',
    exec: [
      'const body = pm.response.json();',
      'if (body.success) { pm.collectionVariables.set("token", body.data.token); }',
      'pm.test("signed in", () => pm.expect(body.success).to.be.true);',
    ],
  },
};

const toPostmanPath = (path) => path.replace(/\{(\w+)\}/g, '{{$1}}');

const queryFor = (op) =>
  (op.parameters ?? [])
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: String(p.schema?.default ?? ''), disabled: true, description: p.schema?.description ?? '' }));

const bodyFor = (op) => {
  const example = op.requestBody?.content?.['application/json']?.example;
  return example ? { mode: 'raw', raw: JSON.stringify(example, null, 2), options: { raw: { language: 'json' } } } : undefined;
};

const item = (name, method, path, op, extra = {}) => {
  const raw = `{{baseUrl}}${toPostmanPath(path)}`;
  const query = queryFor(op);
  return {
    name,
    request: {
      method: method.toUpperCase(),
      header: op.requestBody ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url: { raw, host: ['{{baseUrl}}'], path: toPostmanPath(path).split('/').filter(Boolean), ...(query.length && { query }) },
      ...(bodyFor(op) && { body: bodyFor(op) }),
      description: [op.summary, op.description].filter(Boolean).join('\n\n'),
      ...(Array.isArray(op.security) && op.security.length === 0 && { auth: { type: 'noauth' } }),
    },
    ...extra,
  };
};

const folders = new Map();
for (const [path, ops] of Object.entries(openApiSpec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const tag = op.tags?.[0] ?? 'Other';
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(item(`${method.toUpperCase()} ${path} · ${op.summary}`, method, path, op));
  }
}

// Convenience logins first, so a reviewer can run them and then anything else.
const loginOp = openApiSpec.paths['/auth/login'].post;
const login = (label, email, password) =>
  item(label, 'post', '/auth/login', { ...loginOp, requestBody: { content: { 'application/json': { example: { email, password } } } } }, { event: [saveToken] });

const collection = {
  info: {
    name: 'BookLeaf Author Support API',
    description: `${openApiSpec.info.description}\n\nRun "Login as admin" or "Login as author" first: they store {{token}} for every other request.`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000/api/v1' },
    { key: 'token', value: '' },
    { key: 'ticketId', value: 'BL-0005' },
    { key: 'bookId', value: 'BK005' },
  ],
  item: [
    {
      name: 'Start here',
      item: [
        login('Login as admin', 'admin@bookleaf.com', 'Admin@123'),
        login('Login as author (Ananya)', 'ananya.reddy@email.com', 'Author@123'),
      ],
    },
    ...[...folders].map(([name, items]) => ({ name, item: items })),
  ],
};

await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(collection, null, 2)}\n`);
const count = [...folders.values()].reduce((n, items) => n + items.length, 0);
console.log(`Wrote ${count} requests (+2 logins) to ${OUT.pathname}`);
