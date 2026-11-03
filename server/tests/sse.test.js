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
const openStream = (token, untilText = 'event: ready', path = '/api/v1/tickets/stream') =>
  new Promise((resolve, reject) => {
    const req = http.get(
      { port: server.address().port, path, headers: { Authorization: `Bearer ${token}` } },
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

test('admin stream requires an admin token', async () => {
  expectError(await request(app).get('/api/v1/admin/tickets/stream').set(bearer(priyaToken)), 403, 'FORBIDDEN');
});

test('admins see a new ticket live when an author opens it', async () => {
  const { req, body } = await openStream(adminToken, 'event: ready', '/api/v1/admin/tickets/stream');

  await request(app)
    .post('/api/v1/tickets')
    .set(bearer(priyaToken))
    .send({ subject: 'Live event check', description: 'Checking that the admin queue sees this live.' });

  await waitFor(() => body().includes('event: ticket.created'));
  expect(body()).toContain('"subject":"Live event check"');
  expect(body()).toContain('"authorName":"Priya Sharma"');
  req.destroy();
});

test("the author sees an admin reply live; internal notes and AI metadata never reach the author's stream", async () => {
  const { req, body } = await openStream(priyaToken);
  const base = `/api/v1/admin/tickets/${world.priyaTicket.ticketNumber}`;

  await request(app).post(`${base}/notes`).set(bearer(adminToken)).send({ body: 'TOP SECRET note' });
  await request(app).post(`${base}/reply`).set(bearer(adminToken)).send({ body: 'Live reply for Priya', wasAiDrafted: true });

  await waitFor(() => body().includes('event: ticket.message'));
  expect(body()).toContain('Live reply for Priya');
  expect(body()).toContain('"status":"In Progress"');
  for (const hidden of ['TOP SECRET', 'wasAiDrafted', 'priority', 'isInternalNote']) {
    expect(body()).not.toContain(hidden);
  }
  req.destroy();
});
