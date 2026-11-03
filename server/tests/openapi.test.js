import http from 'node:http';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openApiSpec } from '../src/docs/openapi.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs } from './helpers/fixtures.js';

const app = createApp();
const routesDir = new URL('../src/routes/', import.meta.url);

/** "METHOD /path/{param}" for every route declared in src/routes, read from source. */
const declaredRoutes = async () => {
  const index = await readFile(new URL('index.js', routesDir), 'utf8');
  const files = Object.fromEntries([...index.matchAll(/import (\w+) from '\.\/([\w.]+)';/g)].map((m) => [m[1], m[2]]));
  const mounts = [...index.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)].map((m) => [m[1], files[m[2]]]);

  const routes = new Set();
  for (const [prefix, file] of mounts) {
    const source = await readFile(new URL(file, routesDir), 'utf8');
    for (const m of source.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
      const path = `${prefix}${m[2] === '/' ? '' : m[2]}`.replace(/:(\w+)/g, '{$1}');
      routes.add(`${m[1].toUpperCase()} ${path}`);
    }
  }
  return routes;
};

const documentedRoutes = () =>
  new Set(
    Object.entries(openApiSpec.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
    ),
  );

let world;
let tokens;

beforeAll(async () => {
  await connectTestDB('openapi');
  world = await createWorld();
  tokens = {
    author: await loginAs(app, 'priya.sharma@email.com'),
    admin: await loginAs(app, 'admin@bookleaf.com'),
  };
});

afterAll(closeTestDB);

describe('OpenAPI spec', () => {
  test('documents exactly the routes the server declares (no missing, no stale)', async () => {
    const declared = await declaredRoutes();
    const documented = documentedRoutes();

    expect(declared.size).toBeGreaterThan(20);
    expect([...declared].filter((r) => !documented.has(r))).toEqual([]); // undocumented endpoints
    expect([...documented].filter((r) => !declared.has(r))).toEqual([]); // documented but gone
  });

  test('every documented operation resolves to a real route', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    const ref = world.priyaTicket.ticketNumber;

    try {
      for (const [path, ops] of Object.entries(openApiSpec.paths)) {
        for (const method of Object.keys(ops)) {
          const role = path.startsWith('/admin') || path === '/users' ? 'admin' : 'author';
          const url = `/api/v1${path.replace('{ticketId}', ref).replace('{bookId}', 'BK001')}`;

          if (path.endsWith('/stream')) {
            // SSE never finishes: just check the stream opens.
            const status = await new Promise((resolve, reject) => {
              const req = http.get({ port, path: url, headers: { Authorization: `Bearer ${tokens[role]}` } }, (res) => {
                resolve(res.statusCode);
                req.destroy();
              });
              req.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
            });
            expect(`${method} ${path} -> ${status}`).toBe(`${method} ${path} -> 200`);
            continue;
          }

          const res = await request(app)[method](url).set(bearer(tokens[role])).send(method === 'get' ? undefined : {});
          const routeMissing = res.status === 404 && res.body.error?.message?.startsWith('Route ');
          expect(`${method.toUpperCase()} ${path} missing=${routeMissing}`).toBe(`${method.toUpperCase()} ${path} missing=false`);
          expect(res.status).toBeLessThan(500 + (path.endsWith('/draft') ? 4 : 0)); // draft may be 503 (AI disabled in tests)
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('every $ref resolves', () => {
    const refs = JSON.stringify(openApiSpec).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const raw of new Set(refs)) {
      const pointer = raw.slice(8, -1).replace(/^#\//, '').split('/');
      const target = pointer.reduce((node, key) => node?.[key], openApiSpec);
      expect(`${raw} -> ${Boolean(target)}`).toBe(`${raw} -> true`);
    }
  });

  test('Swagger UI and the raw spec are served publicly', async () => {
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');

    const raw = await request(app).get('/api/docs/openapi.json');
    expect(raw.status).toBe(200);
    expect(raw.body.openapi).toBe('3.0.3');
    expect(Object.keys(raw.body.paths)).toContain('/admin/tickets/{ticketId}/draft');
  });
});
