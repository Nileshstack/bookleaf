/**
 * End-to-end API + real-time suite (QA phases 1 and 3).
 *
 *   npm run test:e2e
 *
 * Boots the real Express app on an in-memory MongoDB seeded with the
 * provided dataset (the same seedDatabase() used by `npm run seed`) and
 * exercises it over HTTP, including real SSE streams. OpenAI is not called
 * (no key), so classification goes through the rule-based fallback
 * deterministically. Phase 2 covers the real model.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openApiSpec } from '../src/docs/openapi.js';
import { Ticket, TicketMessage } from '../src/models/index.js';
import { seedDatabase } from '../src/seed/seed.js';
import { stats as streamStats } from '../src/services/eventHub.js';
import { closeTestDB, connectTestDB } from '../tests/helpers/db.js';

const app = createApp();
const dataset = JSON.parse(await readFile(new URL('../src/seed/data.json', import.meta.url), 'utf8')).authors;
const API = '/api/v1';
const PASSWORD = 'Author@123';

let server;
const tokens = {};
const login = async (email, password = PASSWORD) => {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
  return res.body.data.token;
};
const as = (who) => ({
  get: (p) => request(app).get(`${API}${p}`).set('Authorization', `Bearer ${tokens[who]}`),
  post: (p, body = {}) => request(app).post(`${API}${p}`).set('Authorization', `Bearer ${tokens[who]}`).send(body),
  patch: (p, body = {}) => request(app).patch(`${API}${p}`).set('Authorization', `Bearer ${tokens[who]}`).send(body),
  delete: (p) => request(app).delete(`${API}${p}`).set('Authorization', `Bearer ${tokens[who]}`),
});

/** The one error envelope every failure must use, with no stack trace. */
const expectErrorShape = (res, status, code) => {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ success: false, error: { code, message: expect.any(String), details: expect.any(Array), requestId: expect.any(String) } });
  expect(JSON.stringify(res.body)).not.toMatch(/\bat \w+ \(|node_modules|\.js:\d+/);
};

beforeAll(async () => {
  await connectTestDB('e2e');
  await seedDatabase();
  for (const a of dataset) tokens[a.author_id] = await login(a.email);
  tokens.admin = await login('admin@bookleaf.com', 'Admin@123');
  server = app.listen(0);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestDB();
});

// ---------------------------------------------------------------------------
// Phase 1 · Auth
// ---------------------------------------------------------------------------
describe('Phase 1 · Auth', () => {
  test('valid login: 200, httpOnly cookie, user without password hash', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'Priya.Sharma@email.com ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: 'priya.sharma@email.com', role: 'author', authorCode: 'AUTH001' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.headers['set-cookie'].join(';')).toMatch(/bl_token=.*HttpOnly/i);
  });

  test('invalid password and unknown email: identical 401, no cookie', async () => {
    const wrong = await request(app).post(`${API}/auth/login`).send({ email: 'priya.sharma@email.com', password: 'nope-nope' });
    const unknown = await request(app).post(`${API}/auth/login`).send({ email: 'ghost@email.com', password: 'nope-nope' });
    expectErrorShape(wrong, 401, 'INVALID_CREDENTIALS');
    expectErrorShape(unknown, 401, 'INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  test('malformed email: 422 naming the field', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'not-an-email', password: 'x' });
    expectErrorShape(res, 422, 'VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain('email');
  });

  test('every documented endpoint except health, login and logout requires auth (401 without a token)', async () => {
    const PUBLIC = new Set(['/health', '/auth/login', '/auth/logout']);
    let checked = 0;
    for (const [path, ops] of Object.entries(openApiSpec.paths)) {
      for (const method of Object.keys(ops)) {
        const url = `${API}${path.replace('{ticketId}', 'BL-0005').replace('{bookId}', 'BK001')}`;
        const res = await request(app)[method](url).send(method === 'get' ? undefined : {});
        if (PUBLIC.has(path)) expect(res.status).not.toBe(401);
        else {
          expectErrorShape(res, 401, 'UNAUTHORIZED');
          checked += 1;
        }
      }
    }
    expect(checked).toBe(20);
  });

  test('/me with Bearer and with cookie; logout clears the cookie', async () => {
    expect((await as('AUTH001').get('/auth/me')).body.data.user.authorCode).toBe('AUTH001');
    const agent = request.agent(app);
    await agent.post(`${API}/auth/login`).send({ email: 'meera.nair@email.com', password: PASSWORD });
    expect((await agent.get(`${API}/auth/me`)).status).toBe(200);
    const out = await agent.post(`${API}/auth/logout`);
    expect(out.status).toBe(200);
    expectErrorShape(await agent.get(`${API}/auth/me`), 401, 'UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// Phase 1 · RBAC and ownership
// ---------------------------------------------------------------------------
describe('Phase 1 · RBAC and ownership', () => {
  test('an author calling any admin route gets 403', async () => {
    const adminOps = Object.entries(openApiSpec.paths).filter(([p]) => p.startsWith('/admin') || p === '/users');
    for (const [path, ops] of adminOps) {
      for (const method of Object.keys(ops)) {
        const res = await as('AUTH001')[method](path.replace('{ticketId}', 'BL-0005')).send?.({}) ?? (await as('AUTH001')[method](path.replace('{ticketId}', 'BL-0005')));
        expectErrorShape(res, 403, 'FORBIDDEN');
      }
    }
  });

  test('an admin calling author routes gets 403', async () => {
    for (const p of ['/books', '/tickets', '/tickets/BL-0005']) expectErrorShape(await as('admin').get(p), 403, 'FORBIDDEN');
  });

  test("another author's ticket and book are 404, indistinguishable from missing", async () => {
    const ticket = await as('AUTH001').get('/tickets/BL-0005'); // Ananya's
    const missing = await as('AUTH001').get('/tickets/BL-9999');
    expectErrorShape(ticket, 404, 'NOT_FOUND');
    expect(ticket.body.error.message).toBe(missing.body.error.message);
    expectErrorShape(await as('AUTH001').get('/books/BK005'), 404, 'NOT_FOUND');
    const byId = await Ticket.findOne({ ticketNumber: 'BL-0005' }).lean();
    expectErrorShape(await as('AUTH001').get(`/tickets/${byId._id}`), 404, 'NOT_FOUND');
    expectErrorShape(await as('AUTH001').post('/tickets/BL-0005/messages', { body: 'hi' }), 404, 'NOT_FOUND');
  });

  test("creating a ticket against another author's book is rejected (422 bookId)", async () => {
    const before = await Ticket.countDocuments();
    const res = await as('AUTH001').post('/tickets', { bookId: 'BK005', subject: 'Not my book', description: 'Trying to attach a book that belongs to Ananya.' });
    expectErrorShape(res, 422, 'VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('bookId');
    expect(await Ticket.countDocuments()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 · Author books (all 10 authors vs the dataset)
// ---------------------------------------------------------------------------
describe('Phase 1 · Author books', () => {
  test('every author sees exactly their books from the JSON (18 in total)', async () => {
    let total = 0;
    for (const a of dataset) {
      const res = await as(a.author_id).get('/books');
      expect(res.status).toBe(200);
      expect(res.body.data.map((b) => b.bookId).sort()).toEqual(a.books.map((b) => b.book_id).sort());
      for (const b of a.books) {
        const got = res.body.data.find((x) => x.bookId === b.book_id);
        expect(got).toMatchObject({
          title: b.title,
          isbn: b.isbn,
          status: b.status,
          mrp: b.mrp,
          totalCopiesSold: b.total_copies_sold,
          totalRoyaltyEarned: b.total_royalty_earned,
          royaltyPaid: b.royalty_paid,
          royaltyPending: b.royalty_pending,
          availableOn: b.available_on,
        });
      }
      total += res.body.data.length;
    }
    expect(total).toBe(18);
  });

  test.each([
    ['AUTH007', 'BK013', 'Midnight in Mysore', 'Cover Design', 3],
    ['AUTH009', 'BK015', 'Raising Roots', 'Typesetting', 4],
  ])('%s %s (%s) in production: null figures, never zeros, plus stage', async (author, bookId, title, stage, step) => {
    const book = (await as(author).get(`/books/${bookId}`)).body.data;
    expect(book).toMatchObject({ title, isPublished: false, mrp: null, royaltyPerCopy: null, publicationDate: null, printPartner: null, availableOn: [] });
    expect(book.royaltyBreakdown).toMatchObject({ payoutStatus: 'not_yet_published', totalEarned: null, paid: null, pending: null, paidPercentage: null });
    expect(book.production).toMatchObject({ currentStage: stage, stepNumber: step, totalSteps: 9 });
  });

  test.each([
    ['AUTH003', 'BK005', 'awaiting_first_payout', 2546, false],
    ['AUTH006', 'BK010', 'awaiting_first_payout', 2464, false],
    ['AUTH009', 'BK016', 'awaiting_first_payout', 850, true],
    ['AUTH010', 'BK018', 'awaiting_first_payout', 1575, false],
  ])('%s %s zero royalty paid: %s, pending %d, below threshold=%s', async (author, bookId, status, pending, rollsOver) => {
    const r = (await as(author).get(`/books/${bookId}`)).body.data.royaltyBreakdown;
    expect(r).toMatchObject({ payoutStatus: status, paid: 0, pending, paidPercentage: 0, lastPayoutDate: null, rollsOverToNextQuarter: rollsOver, meetsPayoutThreshold: !rollsOver });
    expect(r.nextScheduledPayout).toEqual({ quarterEnd: expect.any(String), payoutBy: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Phase 1 · Ticket lifecycle (author)
// ---------------------------------------------------------------------------
describe('Phase 1 · Ticket lifecycle', () => {
  let created;

  test('create with a book: 201 + Location, unclassified at creation, then classified in the background', async () => {
    const res = await as('AUTH001').post('/tickets', {
      bookId: 'BK001',
      subject: 'Royalty for Whispers of the Ganges',
      description: 'My dashboard shows Rs 3,570 pending. When will it be paid?',
      attachments: [{ fileName: 'statement.pdf', sizeBytes: 2048, mimeType: 'application/pdf' }],
    });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/tickets/${res.body.data.ticketNumber}`);
    expect(res.body.data).toMatchObject({ status: 'Open', book: { bookId: 'BK001' }, attachments: [{ fileName: 'statement.pdf' }] });
    created = res.body.data;

    for (let i = 0; i < 50 && (await Ticket.findById(created._id).lean()).aiStatus === 'pending'; i += 1) await new Promise((r) => setTimeout(r, 20));
    const stored = await Ticket.findById(created._id).lean();
    expect(stored).toMatchObject({ aiStatus: 'failed', classificationSource: 'rules', category: 'Royalty & Payments' }); // no key in e2e
  });

  test('create a General / account-level ticket (no book)', async () => {
    const res = await as('AUTH001').post('/tickets', { bookId: '', subject: 'Update my author bio', description: 'Can I change the bio shown on my Amazon pages?' });
    expect(res.status).toBe(201);
    expect(res.body.data.book).toBeNull();
  });

  test.each([
    ['empty subject', { subject: '', description: 'A perfectly fine description here.' }, 422, 'subject'],
    ['too-short description', { subject: 'Valid subject', description: 'short' }, 422, 'description'],
    ['too many attachments', { subject: 'Valid subject', description: 'A perfectly fine description here.', attachments: Array(6).fill({ fileName: 'a.png', sizeBytes: 1, mimeType: 'image/png' }) }, 422, 'attachments'],
  ])('validation: %s -> %d on %s', async (_l, body, status, field) => {
    const res = await as('AUTH001').post('/tickets', body);
    expectErrorShape(res, status, 'VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field.split('.')[0])).toContain(field);
  });

  test('huge payload (> 100 kB) is rejected with 413 in the standard shape', async () => {
    const res = await as('AUTH001').post('/tickets', { subject: 'Big', description: 'x'.repeat(150_000) });
    expectErrorShape(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  test('list (newest first, own only) and detail', async () => {
    const list = await as('AUTH001').get('/tickets');
    expect(list.body.data[0].ticketNumber).not.toBe(created.ticketNumber); // the General one is newer
    expect(list.body.data.map((t) => t.ticketNumber)).toContain(created.ticketNumber);
    expect(list.body.meta.total).toBe(2);
    const detail = await as('AUTH001').get(`/tickets/${created.ticketNumber}`);
    expect(detail.body.data).toMatchObject({ ticketNumber: created.ticketNumber, messages: [] });
  });

  test('follow-up reply on an Open ticket', async () => {
    const res = await as('AUTH001').post(`/tickets/${created.ticketNumber}/messages`, { body: 'Adding: last payout was 15 Oct.' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket).toMatchObject({ status: 'Open', reopened: false });
  });

  test('reply on a Resolved ticket reopens it (Meera BL-0002)', async () => {
    const res = await as('AUTH005').post('/tickets/BL-0002/messages', { body: 'Actually it has not arrived yet.' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket).toMatchObject({ status: 'Open', reopened: true });
  });

  test('reply on a Closed ticket is rejected with a clear 409 (Diya BL-0001)', async () => {
    const res = await as('AUTH010').post('/tickets/BL-0001/messages', { body: 'One more thing' });
    expectErrorShape(res, 409, 'TICKET_CLOSED');
    expect(res.body.error.message).toMatch(/closed.*open a new ticket/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 · Admin flow
// ---------------------------------------------------------------------------
describe('Phase 1 · Admin flow', () => {
  const RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  test('default sort: unresolved first, then most urgent, then oldest; resolved/closed last', async () => {
    const items = (await as('admin').get('/admin/tickets?limit=100')).body.data;
    const key = (t) => [t.status === 'Open' || t.status === 'In Progress' ? 0 : 1, RANK[t.priority] ?? 2, new Date(t.createdAt).getTime()];
    for (let i = 1; i < items.length; i += 1) {
      const [a, b] = [key(items[i - 1]), key(items[i])];
      const ordered = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])));
      expect(`${items[i - 1].ticketNumber} before ${items[i].ticketNumber}: ${ordered}`).toMatch(/true$/);
    }
    expect(items[0].ticketNumber).toBe('BL-0005'); // Ananya, Critical
    expect(items.at(-1).status).toMatch(/Resolved|Closed/);
  });

  test.each([
    ['status=In Progress', '?status=In%20Progress', (t) => t.status === 'In Progress'],
    ['category', '?category=Printing%20%26%20Quality', (t) => t.category === 'Printing & Quality'],
    ['priority', '?priority=High', (t) => t.priority === 'High'],
    ['search (author name)', '?q=farhan', (t) => t.author.name === 'Farhan Sheikh'],
    ['search (book title)', '?q=ganges', (t) => t.book?.title === 'Whispers of the Ganges'],
  ])('filter %s', async (_l, qs, predicate) => {
    const items = (await as('admin').get(`/admin/tickets${qs}&limit=100`.replace('?', qs.includes('?') ? '?' : '?'))).body.data;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(predicate)).toBe(true);
  });

  test('date range filter', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const items = (await as('admin').get(`/admin/tickets?from=${today}&to=${today}&status=Open,In%20Progress,Resolved,Closed&limit=100`)).body.data;
    expect(items.every((t) => t.createdAt.startsWith(today))).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test('pagination: stable pages with totals', async () => {
    const all = (await as('admin').get('/admin/tickets?limit=100')).body;
    const p1 = (await as('admin').get('/admin/tickets?limit=3&page=1')).body;
    const p2 = (await as('admin').get('/admin/tickets?limit=3&page=2')).body;
    expect(p1.meta).toMatchObject({ page: 1, limit: 3, total: all.meta.total });
    expect([...p1.data, ...p2.data].map((t) => t.ticketNumber)).toEqual(all.data.slice(0, 6).map((t) => t.ticketNumber));
  });

  test('assign-to-me, then assignedTo=me filter', async () => {
    const res = await as('admin').post('/admin/tickets/BL-0006/assign-to-me');
    expect(res.body.data.assignedTo.name).toBe('BookLeaf Support');
    const mine = (await as('admin').get('/admin/tickets?assignedTo=me&limit=100')).body.data;
    expect(mine.map((t) => t.ticketNumber)).toContain('BL-0006');
  });

  test('status update, and category/priority override keeping the AI values', async () => {
    await Ticket.updateOne({ ticketNumber: 'BL-0007' }, { $set: { aiCategory: 'Distribution & Availability', aiPriority: 'High', aiStatus: 'done' } });
    const res = await as('admin').patch('/admin/tickets/BL-0007', { status: 'In Progress', category: 'General Inquiry', priority: 'Critical' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'In Progress',
      category: 'General Inquiry',
      aiCategory: 'Distribution & Availability',
      categoryOverridden: true,
      priority: 'Critical',
      aiPriority: 'High',
      priorityOverridden: true,
    });
  });

  test('internal note, reply and stats', async () => {
    const note = await as('admin').post('/admin/tickets/BL-0006/notes', { body: 'Checked with distribution.' });
    expect(note.status).toBe(201);
    expect(note.body.data.isInternalNote).toBe(true);
    const reply = await as('admin').post('/admin/tickets/BL-0006/reply', { body: 'Hi Rohit, we are correcting the listing.', wasAiDrafted: true });
    expect(reply.status).toBe(201);
    expect(reply.body.data.ticket.status).toBe('In Progress');
    const stats = (await as('admin').get('/admin/stats')).body.data;
    expect(stats.total).toBe(await Ticket.countDocuments());
    expect(stats.ai.drafts.aiDrafted).toBeGreaterThanOrEqual(1);
  });

  test('CRITICAL: internal notes and AI metadata never reach the author (detail, list, every field)', async () => {
    const SECRET_NOTE = 'SECRET-NOTE-author-is-difficult-do-not-share';
    const SECRET_REASON = 'SECRET-REASONING-payout-batch-failed';
    await Ticket.updateOne(
      { ticketNumber: 'BL-0005' },
      { $set: { aiReasoning: SECRET_REASON, aiCategory: 'Royalty & Payments', aiPriority: 'Critical', aiConfidence: 0.97, classificationSource: 'ai', aiStatus: 'done', aiError: 'none' } },
    );
    await as('admin').post('/admin/tickets/BL-0005/notes', { body: SECRET_NOTE });
    await as('admin').post('/admin/tickets/BL-0005/reply', { body: 'Hi Ananya, we are on it.', wasAiDrafted: true });

    const detail = await as('AUTH003').get('/tickets/BL-0005');
    const list = await as('AUTH003').get('/tickets');
    for (const res of [detail, list]) {
      const raw = JSON.stringify(res.body);
      for (const forbidden of [SECRET_NOTE, SECRET_REASON, 'aiReasoning', 'aiPriority', 'aiCategory', 'aiConfidence', 'aiStatus', 'aiError', 'classificationSource', '"priority"', 'priorityRank', 'isInternalNote', 'wasAiDrafted', 'assignedTo', 'Overridden']) {
        expect(`${forbidden} present: ${raw.includes(forbidden)}`).toBe(`${forbidden} present: false`);
      }
    }
    expect(detail.body.data.messages.map((m) => m.body)).toContain('Hi Ananya, we are on it.');
    expect(await TicketMessage.countDocuments({ body: SECRET_NOTE })).toBe(1); // it exists, it's just never shown
  });
});

// ---------------------------------------------------------------------------
// Phase 1 · Error handling
// ---------------------------------------------------------------------------
describe('Phase 1 · Error handling (consistent JSON, never a stack trace)', () => {
  test('malformed JSON -> 400', async () => {
    const res = await request(app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send('{"email": ');
    expectErrorShape(res, 400, 'BAD_REQUEST');
  });

  test('invalid ObjectId / ticket ref -> 400 naming the param', async () => {
    const res = await as('AUTH001').get('/tickets/12345-not-an-id');
    expectErrorShape(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('ticketId');
    expectErrorShape(await as('admin').get('/admin/tickets?assignedTo=not-an-id'), 400, 'VALIDATION_ERROR');
  });

  test('unknown route -> JSON 404', async () => {
    expectErrorShape(await as('AUTH001').get('/does-not-exist'), 404, 'NOT_FOUND');
    expectErrorShape(await request(app).get('/totally/elsewhere'), 404, 'NOT_FOUND');
  });

  test('wrong HTTP method -> JSON error, not an HTML page', async () => {
    const res = await as('AUTH001').delete('/tickets');
    expect(res.headers['content-type']).toMatch(/json/);
    expect([404, 405]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test('responses never expose a stack trace or x-powered-by', async () => {
    const res = await as('AUTH001').get('/tickets/12345-not-an-id');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/stack|Error: /);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 · Real-time (SSE) over real HTTP
// ---------------------------------------------------------------------------
describe('Phase 3 · Server-Sent Events', () => {
  const openStream = (who, path) =>
    new Promise((resolve, reject) => {
      let raw = '';
      const req = http.get({ port: server.address().port, path: `${API}${path}`, headers: { Authorization: `Bearer ${tokens[who]}` } }, (res) => {
        res.setEncoding('utf8');
        const stream = {
          raw: () => raw,
          events: () =>
            raw
              .split('\n\n')
              .filter((b) => b.includes('event: '))
              .map((b) => ({ event: b.match(/event: (.*)/)[1], data: JSON.parse(b.match(/data: (.*)/)[1]) })),
          next: async (name, match = () => true) => {
            for (let i = 0; i < 150; i += 1) {
              const hit = stream.events().find((e) => e.event === name && match(e.data));
              if (hit) return hit;
              await new Promise((r) => setTimeout(r, 20));
            }
            throw new Error(`no ${name}; got ${stream.events().map((e) => e.event)}`);
          },
          close: () => req.destroy(),
        };
        res.on('data', (c) => {
          raw += c;
          if (raw.includes('event: ready')) resolve(stream);
        });
      });
      req.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
    });

  test('full live loop between an author, another author and the admin', async () => {
    const author = await openStream('AUTH008', '/tickets/stream'); // Farhan
    const other = await openStream('AUTH002', '/tickets/stream'); // Rohit (bystander)
    const admin = await openStream('admin', '/admin/tickets/stream');

    // New ticket -> admin gets new_ticket, then ticket_classified.
    const created = (await as('AUTH008').post('/tickets', { bookId: 'BK014', subject: 'Book unavailable on Flipkart', description: 'My poetry book shows out of stock on Flipkart since Monday.' })).body.data;
    await admin.next('new_ticket', (d) => d.ticket.ticketNumber === created.ticketNumber);
    await admin.next('ticket_classified', (d) => d.ticket.ticketNumber === created.ticketNumber);
    const order = admin.events().filter((e) => e.data.ticket?.ticketNumber === created.ticketNumber).map((e) => e.event);
    expect(order.indexOf('new_ticket')).toBeLessThan(order.indexOf('ticket_classified'));

    // Internal note -> nothing to the author. Admin reply -> admin_reply + status_changed.
    await as('admin').post(`/admin/tickets/${created.ticketNumber}/notes`, { body: 'PRIVATE: re-sync requested' });
    await as('admin').post(`/admin/tickets/${created.ticketNumber}/reply`, { body: 'Hi Farhan, triggering a re-sync now.' });
    const reply = await author.next('admin_reply', (d) => d.ticket.ticketNumber === created.ticketNumber);
    expect(reply.data.message.body).toBe('Hi Farhan, triggering a re-sync now.');
    await author.next('status_changed', (d) => d.ticket.status === 'In Progress');

    // Admin resolves -> author status_changed.
    await as('admin').patch(`/admin/tickets/${created.ticketNumber}`, { status: 'Resolved' });
    await author.next('status_changed', (d) => d.ticket.status === 'Resolved');

    // Author replies -> admin author_reply (and it reopens).
    await as('AUTH008').post(`/tickets/${created.ticketNumber}/messages`, { body: 'Still not visible, sorry!' });
    const ar = await admin.next('author_reply', (d) => d.ticket.ticketNumber === created.ticketNumber);
    expect(ar.data).toMatchObject({ reopened: true, authorName: 'Farhan Sheikh' });

    // Isolation and leakage.
    expect(other.events().filter((e) => e.event !== 'ready')).toEqual([]);
    for (const forbidden of ['PRIVATE', 'priority', 'aiReasoning', 'isInternalNote', 'wasAiDrafted', 'assignedTo']) {
      expect(`${forbidden}: ${author.raw().includes(forbidden)}`).toBe(`${forbidden}: false`);
    }

    // Heartbeats arrive.
    await new Promise((r) => setTimeout(r, 400));
    expect(author.raw()).toContain(': ping');

    // Disconnects clean up.
    const before = streamStats().connections;
    author.close();
    other.close();
    admin.close();
    for (let i = 0; i < 50 && streamStats().connections > before - 3; i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(streamStats().connections).toBe(before - 3);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 · Login rate limiting (last: it blocks further logins from this IP)
// ---------------------------------------------------------------------------
describe('Phase 1 · Login rate limiting', () => {
  test('the 11th failed login in the window gets 429, even with the right password', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post(`${API}/auth/login`).send({ email: 'vikram.joshi@email.com', password: `wrong-${i}` });
      if (res.status === 429) break; // earlier failures in this run already count
    }
    expectErrorShape(await request(app).post(`${API}/auth/login`).send({ email: 'vikram.joshi@email.com', password: 'wrong-again' }), 429, 'RATE_LIMITED');
    expectErrorShape(await request(app).post(`${API}/auth/login`).send({ email: 'vikram.joshi@email.com', password: PASSWORD }), 429, 'RATE_LIMITED');
  });
});
