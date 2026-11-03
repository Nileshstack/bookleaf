import http from 'node:http';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectionCount, publishToUser } from '../src/services/realtime.service.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs } from './helpers/fixtures.js';

const app = createApp();
let server;
let world;
let priyaToken;
let adminToken;

beforeAll(async () => {
  await connectTestDB('sse');
  world = await createWorld();
  priyaToken = await loginAs(app, 'priya.sharma@email.com');
  adminToken = await loginAs(app, 'admin@bookleaf.com');
  server = app.listen(0);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestDB();
});

/** Opens the stream and resolves once `untilText` has arrived; the caller decides when to close. */
const openStream = (token, untilText = 'event: ready') =>
  new Promise((resolve, reject) => {
    const req = http.get(
      { port: server.address().port, path: '/api/v1/tickets/stream', headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.includes(untilText)) resolve({ req, res, body: () => body });
        });
      },
    );
    req.on('error', (err) => (err.code === 'ECONNRESET' ? undefined : reject(err)));
  });

const waitFor = async (predicate) => {
  for (let i = 0; i < 50 && !predicate(); i += 1) await new Promise((r) => setTimeout(r, 10));
};

test('authenticated author gets an event stream with a ready event', async () => {
  const { req, res, body } = await openStream(priyaToken);

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
  expect(res.headers['cache-control']).toMatch(/no-cache/);
  expect(body()).toContain('retry: 5000');
  expect(body()).toContain(`"userId":"${world.priya._id}"`);
  expect(connectionCount()).toBe(1);

  req.destroy();
  await waitFor(() => connectionCount() === 0);
  expect(connectionCount()).toBe(0); // the disconnect is cleaned up
});

test('publishToUser delivers to that user’s open stream', async () => {
  const { req, body } = await openStream(priyaToken);

  expect(publishToUser(world.priya._id, 'ticket.updated', { ticketNumber: 'BL-0001' })).toBe(1);
  await waitFor(() => body().includes('ticket.updated'));
  expect(body()).toContain('event: ticket.updated\ndata: {"ticketNumber":"BL-0001"}');

  expect(publishToUser(world.rohit._id, 'ticket.updated', {})).toBe(0); // nobody listening
  req.destroy();
});

test('stream requires an author token', async () => {
  expectError(await request(app).get('/api/v1/tickets/stream'), 401, 'UNAUTHORIZED');
  expectError(await request(app).get('/api/v1/tickets/stream').set(bearer(adminToken)), 403, 'FORBIDDEN');
});
