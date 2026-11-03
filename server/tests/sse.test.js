import http from 'node:http';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeAll, stats } from '../src/services/eventHub.js';
import * as ticketEvents from '../src/services/ticketEvents.js';
import { classifyTicket } from '../src/services/triage.service.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs } from './helpers/fixtures.js';

const app = createApp();
let server;
let world;
let priyaToken;
let rohitToken;
let adminToken;

const AUTHOR_STREAM = '/api/v1/tickets/stream';
const ADMIN_STREAM = '/api/v1/admin/tickets/stream';

beforeAll(async () => {
  await connectTestDB('sse');
  world = await createWorld();
  [priyaToken, rohitToken, adminToken] = await Promise.all([
    loginAs(app, 'priya.sharma@email.com'),
    loginAs(app, 'rohit.kapoor@email.com'),
    loginAs(app, 'admin@bookleaf.com'),
  ]);
  server = app.listen(0);
});

afterEach(() => closeAll());

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestDB();
});

/** Parses raw SSE text into frames: { id, event, data, comment }. */
const parseFrames = (text) =>
  text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const frame = { comment: false };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) frame.comment = true;
        const [key, ...rest] = line.split(': ');
        const value = rest.join(': ');
        if (key === 'id') frame.id = value;
        if (key === 'event') frame.event = value;
        if (key === 'data') frame.data = JSON.parse(value);
      }
      return frame;
    });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a real HTTP stream; resolves once `ready` has arrived. */
const openStream = (token, { path = AUTHOR_STREAM, lastEventId } = {}) =>
  new Promise((resolve, reject) => {
    let raw = '';
    let ended = false;
    const req = http.get(
      {
        port: server.address().port,
        path,
        headers: { Authorization: `Bearer ${token}`, ...(lastEventId && { 'Last-Event-ID': lastEventId }) },
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('end', () => (ended = true));
        const stream = {
          req,
          res,
          raw: () => raw,
          frames: () => parseFrames(raw),
          events: (name) => parseFrames(raw).filter((f) => f.event === name),
          ended: () => ended,
          close: () => req.destroy(),
          /** Waits until an event with this name (optionally matching) arrives. */
          next: async (name, match = () => true) => {
            for (let i = 0; i < 100; i += 1) {
              const found = stream.events(name).find((f) => match(f.data));
              if (found) return found;
              await sleep(10);
            }
            throw new Error(`no "${name}" event; got: ${stream.frames().map((f) => f.event ?? (f.comment ? ':' : '?')).join(',')}`);
          },
        };
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.includes('event: ready')) resolve(stream);
        });
      },
    );
    req.on('error', (err) => (err.code === 'ECONNRESET' ? undefined : reject(err)));
  });

const as = (token) => ({
  get: (path) => request(app).get(path).set(bearer(token)),
  post: (path, body = {}) => request(app).post(path).set(bearer(token)).send(body),
  patch: (path, body) => request(app).patch(path).set(bearer(token)).send(body),
});

const ticketPath = (t) => `/api/v1/admin/tickets/${t.ticketNumber}`;

describe('connection lifecycle', () => {
  test('author stream: SSE headers, retry hint, ready event with a resumable id, cleanup on disconnect', async () => {
    const s = await openStream(priyaToken);

    expect(s.res.statusCode).toBe(200);
    expect(s.res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(s.res.headers['cache-control']).toMatch(/no-cache/);
    expect(s.raw()).toMatch(/^retry: 5000\n\n/);
    const ready = s.events('ready')[0];
    expect(ready.id).toMatch(/^[a-z0-9]+\.\d+$/);
    expect(ready.data).toMatchObject({ replayed: 0, resync: false });
    expect(stats().channels).toMatchObject({ [`user:${world.priya._id}`]: 1 });

    s.close();
    for (let i = 0; i < 50 && stats().connections; i += 1) await sleep(10);
    expect(stats().connections).toBe(0);
  });

  test('heartbeat comments keep the connection alive', async () => {
    const s = await openStream(priyaToken);
    for (let i = 0; i < 50 && !s.raw().includes(': ping'); i += 1) await sleep(10);
    expect(s.raw()).toContain(': ping\n\n');
  });

  test('authenticates with the httpOnly cookie, as a browser EventSource would', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'priya.sharma@email.com', password: 'Author@123' });
    const cookie = login.headers['set-cookie'].find((c) => c.startsWith('bl_token=')).split(';')[0];

    const body = await new Promise((resolve, reject) => {
      const req = http.get({ port: server.address().port, path: AUTHOR_STREAM, headers: { Cookie: cookie } }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.includes('event: ready')) {
            req.destroy();
            resolve({ status: res.statusCode, raw });
          }
        });
      });
      req.on('error', (err) => (err.code === 'ECONNRESET' ? undefined : reject(err)));
    });
    expect(body.status).toBe(200);
    expect(body.raw).toContain('event: ready');
  });

  test('auth: 401 without a token; each role can only open its own stream', async () => {
    expectError(await request(app).get(AUTHOR_STREAM), 401, 'UNAUTHORIZED');
    expectError(await as(adminToken).get(AUTHOR_STREAM), 403, 'FORBIDDEN');
    expectError(await as(priyaToken).get(ADMIN_STREAM), 403, 'FORBIDDEN');
  });

  test('a user gets at most 5 streams; the oldest is closed', async () => {
    const streams = [];
    for (let i = 0; i < 6; i += 1) streams.push(await openStream(priyaToken));
    for (let i = 0; i < 50 && !streams[0].ended(); i += 1) await sleep(10);

    expect(streams[0].ended()).toBe(true);
    expect(streams.slice(1).every((s) => !s.ended())).toBe(true);
    expect(stats().channels[`user:${world.priya._id}`]).toBe(5);
  });

  test('closeAll ends every stream (used on shutdown)', async () => {
    const a = await openStream(priyaToken);
    const b = await openStream(adminToken, { path: ADMIN_STREAM });
    closeAll();
    for (let i = 0; i < 50 && !(a.ended() && b.ended()); i += 1) await sleep(10);
    expect(a.ended() && b.ended()).toBe(true);
    expect(stats().connections).toBe(0);
  });
});

describe('admin stream events', () => {
  test('new_ticket when an author creates a ticket', async () => {
    const admin = await openStream(adminToken, { path: ADMIN_STREAM });
    await as(priyaToken).post('/api/v1/tickets', { subject: 'Live event check', description: 'Checking the admin queue sees this live.' });

    const { data } = await admin.next('new_ticket');
    expect(data).toMatchObject({ authorName: 'Priya Sharma', ticket: { subject: 'Live event check', status: 'Open' } });
  });

  test('author_reply when an author follows up', async () => {
    const admin = await openStream(adminToken, { path: ADMIN_STREAM });
    await as(priyaToken).post(`/api/v1/tickets/${world.priyaTicket.ticketNumber}/messages`, { body: 'Any update on my payout?' });

    const { data } = await admin.next('author_reply');
    expect(data).toMatchObject({
      ticket: { ticketNumber: world.priyaTicket.ticketNumber },
      preview: 'Any update on my payout?',
      reopened: false,
    });
  });

  test('ticket_updated for edits, assignment and notes, with the changed fields', async () => {
    const admin = await openStream(adminToken, { path: ADMIN_STREAM });
    await as(adminToken).patch(ticketPath(world.rohitTicket), { priority: 'Critical' });
    await as(adminToken).post(`${ticketPath(world.rohitTicket)}/assign-to-me`);
    await as(adminToken).post(`${ticketPath(world.rohitTicket)}/notes`, { body: 'Checked with production' });

    await admin.next('ticket_updated', (d) => d.changes.includes('internalNote'));
    expect(admin.events('ticket_updated').map((f) => f.data.changes)).toEqual([['priority'], ['assignedTo'], ['internalNote']]);
    expect(admin.events('ticket_updated')[0].data).toMatchObject({ actorName: 'BookLeaf Support', ticket: { priority: 'Critical' } });
  });

  test('ticket_classified when triage finishes', async () => {
    const admin = await openStream(adminToken, { path: ADMIN_STREAM });
    await classifyTicket(world.rohitTicket._id, { force: true }); // AI disabled in tests, so the rule fallback runs

    const { data } = await admin.next('ticket_classified');
    expect(data).toMatchObject({ ticket: { ticketNumber: world.rohitTicket.ticketNumber, classificationSource: 'rules', aiStatus: 'failed' } });
  });
});

describe('author stream events', () => {
  test('admin_reply and status_changed reach the author, with nothing internal in them', async () => {
    const priya = await openStream(priyaToken);
    const base = ticketPath(world.priyaTicket);

    await as(adminToken).post(`${base}/notes`, { body: 'TOP SECRET note about this author' });
    await as(adminToken).patch(base, { priority: 'High', category: 'Royalty & Payments' }); // no status change
    await as(adminToken).post(`${base}/reply`, { body: 'Live reply for Priya', wasAiDrafted: true });

    const reply = await priya.next('admin_reply');
    expect(reply.data).toEqual({
      ticket: { ticketId: String(world.priyaTicket._id), ticketNumber: world.priyaTicket.ticketNumber, status: 'In Progress', updatedAt: expect.any(String) },
      message: { _id: expect.any(String), senderRole: 'admin', senderName: 'BookLeaf Support', body: 'Live reply for Priya', createdAt: expect.any(String) },
    });
    const status = await priya.next('status_changed');
    expect(status.data).toMatchObject({ previousStatus: 'Open', ticket: { status: 'In Progress' } });

    // Exactly these two events: the note and the priority edit produced nothing for the author.
    expect(priya.frames().filter((f) => f.event && f.event !== 'ready').map((f) => f.event)).toEqual(['admin_reply', 'status_changed']);
    for (const hidden of ['TOP SECRET', 'priority', 'aiReasoning', 'wasAiDrafted', 'isInternalNote', 'assignedTo', 'category']) {
      expect(priya.raw()).not.toContain(hidden);
    }
  });

  test('status_changed on an admin status edit', async () => {
    const priya = await openStream(priyaToken);
    await as(adminToken).patch(ticketPath(world.priyaTicket), { status: 'Resolved' });
    expect((await priya.next('status_changed')).data).toMatchObject({ ticket: { status: 'Resolved' } });
  });

  test("an author never receives events about another author's ticket", async () => {
    const rohit = await openStream(rohitToken);
    await as(adminToken).post(`${ticketPath(world.priyaTicket)}/reply`, { body: 'For Priya only', status: 'In Progress' });
    await sleep(100);
    expect(rohit.frames().filter((f) => f.event && f.event !== 'ready')).toEqual([]);
  });

  test('defence in depth: an internal note can never be published to an author channel', () => {
    expect(() =>
      ticketEvents.adminReplied(world.priyaTicket, { body: 'secret', isInternalNote: true }, { previousStatus: 'Open' }),
    ).toThrow(/internal note/);
  });
});

describe('reconnect and replay', () => {
  test('events missed while disconnected are replayed from Last-Event-ID, before ready', async () => {
    const first = await openStream(priyaToken);
    const lastId = first.events('ready')[0].id;
    first.close();

    await as(adminToken).post(`${ticketPath(world.priyaTicket)}/reply`, { body: 'Sent while you were offline', status: 'In Progress' });

    const again = await openStream(priyaToken, { lastEventId: lastId });
    const names = again.frames().filter((f) => f.event).map((f) => f.event);
    expect(names.at(-1)).toBe('ready');
    expect(again.events('admin_reply')[0].data.message.body).toBe('Sent while you were offline');
    expect(again.events('ready')[0].data).toMatchObject({ replayed: names.length - 1, resync: false });
  });

  test('an id from another server boot asks the client to resync instead of replaying', async () => {
    const s = await openStream(priyaToken, { lastEventId: 'oldboot.42' });
    expect(s.events('ready')[0].data).toMatchObject({ replayed: 0, resync: true });
  });

  test('a malformed Last-Event-ID is ignored', async () => {
    const s = await openStream(priyaToken, { lastEventId: "x'; drop" });
    expect(s.events('ready')[0].data).toMatchObject({ replayed: 0, resync: false });
  });
});
