import request from 'supertest';
import { createApp } from '../src/app.js';
import { Ticket, TicketMessage } from '../src/models/index.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs } from './helpers/fixtures.js';

const app = createApp();
let world;
let priyaToken;
let adminToken;

beforeAll(async () => {
  await connectTestDB('tickets');
  world = await createWorld();
  priyaToken = await loginAs(app, 'priya.sharma@email.com');
  adminToken = await loginAs(app, 'admin@bookleaf.com');
});

afterAll(closeTestDB);

const post = (path, token, body) => request(app).post(path).set(bearer(token)).send(body);
const get = (path, token) => request(app).get(path).set(bearer(token));

const validTicket = (overrides = {}) => ({
  bookId: 'BK001',
  subject: 'Question about my payout',
  description: 'My dashboard shows a pending royalty. When will it be paid out?',
  ...overrides,
});

const fieldsOf = (res) => res.body.error.details.map((d) => d.field);

describe('POST /api/v1/tickets', () => {
  test('creates a ticket: 201, Location header, BL number and author-safe body', async () => {
    const res = await post('/api/v1/tickets', priyaToken, validTicket());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ticketNumber: expect.stringMatching(/^BL-\d{4}$/),
      status: 'Open',
      category: null,
      book: { bookId: 'BK001', title: 'Whispers of the Ganges' },
      messages: [],
    });
    expect(res.headers.location).toBe(`/api/v1/tickets/${res.body.data.ticketNumber}`);
    expect(res.body.data).not.toHaveProperty('priority');
    expect(res.body.data).not.toHaveProperty('aiStatus');

    const saved = await Ticket.findById(res.body.data._id).lean();
    expect(String(saved.authorId)).toBe(String(world.priya._id));
    expect(saved.aiStatus).toBe('pending');
  });

  test.each([
    ['omitted', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('bookId %s means General / Account Level', async (_label, bookId) => {
    const res = await post('/api/v1/tickets', priyaToken, validTicket({ bookId }));
    expect(res.status).toBe(201);
    expect(res.body.data.book).toBeNull();
  });

  test('accepts the book by Mongo id as well as by code', async () => {
    const res = await post('/api/v1/tickets', priyaToken, validTicket({ bookId: String(world.priyaBook._id) }));
    expect(res.status).toBe(201);
    expect(res.body.data.book.bookId).toBe('BK001');
  });

  test.each([
    ["another author's book", 'BK003'],
    ['a book that does not exist', 'BK999'],
  ])('rejects %s with 422 on bookId and creates nothing', async (_label, bookId) => {
    const before = await Ticket.countDocuments();
    const res = await post('/api/v1/tickets', priyaToken, validTicket({ bookId }));

    expectError(res, 422, 'VALIDATION_ERROR');
    expect(fieldsOf(res)).toEqual(['bookId']);
    expect(await Ticket.countDocuments()).toBe(before);
  });

  test('ignores fields an author must not set (no mass assignment)', async () => {
    const res = await post(
      '/api/v1/tickets',
      priyaToken,
      validTicket({
        status: 'Closed',
        priority: 'Critical',
        category: 'Royalty & Payments',
        aiStatus: 'done',
        authorId: String(world.rohit._id),
        ticketNumber: 'BL-9999',
      }),
    );

    expect(res.status).toBe(201);
    const saved = await Ticket.findById(res.body.data._id).lean();
    expect(saved).toMatchObject({ status: 'Open', priority: null, category: null, aiStatus: 'pending' });
    expect(String(saved.authorId)).toBe(String(world.priya._id));
    expect(saved.ticketNumber).not.toBe('BL-9999');
  });

  test('stores attachment metadata', async () => {
    const attachments = [{ fileName: 'royalty-statement.pdf', sizeBytes: 120_000, mimeType: 'application/pdf' }];
    const res = await post('/api/v1/tickets', priyaToken, validTicket({ attachments }));

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toEqual([{ ...attachments[0], url: null }]);
  });

  test.each([
    ['empty body', {}, ['subject', 'description']],
    ['too-short subject and description', { subject: 'Hi', description: 'help' }, ['subject', 'description']],
    ['malformed book code', validTicket({ bookId: 'BOOK-1' }), ['bookId']],
    [
      'more than 5 attachments',
      validTicket({ attachments: Array(6).fill({ fileName: 'a.png', sizeBytes: 10, mimeType: 'image/png' }) }),
      ['attachments'],
    ],
    [
      'oversized attachment',
      validTicket({ attachments: [{ fileName: 'big.pdf', sizeBytes: 11 * 1024 * 1024, mimeType: 'application/pdf' }] }),
      ['attachments.0.sizeBytes'],
    ],
    [
      'unsupported file type',
      validTicket({ attachments: [{ fileName: 'virus.exe', sizeBytes: 10, mimeType: 'application/x-msdownload' }] }),
      ['attachments.0.mimeType'],
    ],
  ])('rejects %s with 422 and per-field details', async (_label, body, expectedFields) => {
    const res = await post('/api/v1/tickets', priyaToken, body);
    expectError(res, 422, 'VALIDATION_ERROR');
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(expectedFields));
  });
});

describe('GET /api/v1/tickets', () => {
  test("returns only the author's tickets, newest first, with a preview that skips internal notes", async () => {
    const res = await get('/api/v1/tickets?limit=100', priyaToken);
    expect(res.status).toBe(200);

    const numbers = res.body.data.map((t) => t.ticketNumber);
    expect(numbers).not.toContain(world.rohitTicket.ticketNumber);

    const created = res.body.data.map((t) => new Date(t.createdAt).getTime());
    expect(created).toEqual([...created].sort((a, b) => b - a));

    // The fixture ticket has one public reply and one internal note.
    const fixture = res.body.data.find((t) => t.ticketNumber === world.priyaTicket.ticketNumber);
    expect(fixture.messageCount).toBe(1);
    expect(fixture.lastMessage).toMatchObject({ senderRole: 'admin', preview: 'Public reply to Priya' });
    expect(JSON.stringify(res.body)).not.toContain('SECRET');

    const fresh = res.body.data.find((t) => t.messageCount === 0);
    expect(fresh.lastMessage).toBeNull();
  });

  test('filters by status and rejects an unknown status with 400', async () => {
    const res = await get('/api/v1/tickets?status=Open', priyaToken);
    expect(res.status).toBe(200);
    expect(res.body.data.every((t) => t.status === 'Open')).toBe(true);

    expectError(await get('/api/v1/tickets?status=Pending', priyaToken), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /api/v1/tickets/:id', () => {
  test('returns the thread without internal notes or AI metadata', async () => {
    await Ticket.updateOne(
      { _id: world.priyaTicket._id },
      { $set: { aiReasoning: 'Author mentions payout delay', aiPriority: 'High' } },
    );
    const res = await get(`/api/v1/tickets/${world.priyaTicket.ticketNumber}`, priyaToken);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.map((m) => m.body)).toEqual(['Public reply to Priya']);
    const raw = JSON.stringify(res.body);
    for (const hidden of ['SECRET', 'aiReasoning', 'Author mentions payout delay', 'aiPriority', 'isInternalNote', 'wasAiDrafted']) {
      expect(raw).not.toContain(hidden);
    }
  });

  test("another author's ticket is a 404", async () => {
    expectError(await get(`/api/v1/tickets/${world.rohitTicket.ticketNumber}`, priyaToken), 404, 'NOT_FOUND');
  });
});

describe('POST /api/v1/tickets/:id/messages', () => {
  const reply = (ticketRef, body = { body: 'Any update on this?' }) =>
    post(`/api/v1/tickets/${ticketRef}/messages`, priyaToken, body);

  const ticketWithStatus = async (status) => {
    const t = await Ticket.create({
      authorId: world.priya._id,
      subject: `A ${status} ticket`,
      description: 'Some description long enough.',
      status,
    });
    return t;
  };

  test('reply on an Open ticket keeps it Open and appears as the latest preview', async () => {
    const t = await ticketWithStatus('Open');
    const res = await reply(t.ticketNumber);

    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatchObject({ senderRole: 'author', senderName: 'Priya Sharma', body: 'Any update on this?' });
    expect(res.body.data.ticket).toEqual({ ticketNumber: t.ticketNumber, status: 'Open', reopened: false });

    const after = await Ticket.findById(t._id).lean();
    expect(after.updatedAt.getTime()).toBeGreaterThan(t.updatedAt.getTime());

    const list = await get('/api/v1/tickets?limit=100', priyaToken);
    const row = list.body.data.find((x) => x.ticketNumber === t.ticketNumber);
    expect(row.lastMessage).toMatchObject({ senderRole: 'author', preview: 'Any update on this?' });
  });

  test('reply on a Resolved ticket reopens it', async () => {
    const t = await ticketWithStatus('Resolved');
    const res = await reply(t.ticketNumber, { body: "Sorry, this still isn't fixed." });

    expect(res.status).toBe(201);
    expect(res.body.data.ticket).toMatchObject({ status: 'Open', reopened: true });
    expect((await Ticket.findById(t._id)).status).toBe('Open');
  });

  test('reply on an In Progress ticket keeps it In Progress', async () => {
    const t = await ticketWithStatus('In Progress');
    const res = await reply(t.ticketNumber);
    expect(res.body.data.ticket).toMatchObject({ status: 'In Progress', reopened: false });
  });

  test('reply on a Closed ticket is blocked with 409 TICKET_CLOSED and stores nothing', async () => {
    const t = await ticketWithStatus('Closed');
    const res = await reply(t.ticketNumber);

    expectError(res, 409, 'TICKET_CLOSED');
    expect(res.body.error.message).toMatch(/open a new ticket/i);
    expect(await TicketMessage.countDocuments({ ticketId: t._id })).toBe(0);
  });

  test("reply to another author's ticket is a 404 and stores nothing", async () => {
    const before = await TicketMessage.countDocuments({ ticketId: world.rohitTicket._id });
    expectError(await reply(world.rohitTicket.ticketNumber), 404, 'NOT_FOUND');
    expect(await TicketMessage.countDocuments({ ticketId: world.rohitTicket._id })).toBe(before);
  });

  test('an author cannot post an internal note by sending the flag', async () => {
    const t = await ticketWithStatus('Open');
    await reply(t.ticketNumber, { body: 'Sneaky', isInternalNote: true });
    const stored = await TicketMessage.findOne({ ticketId: t._id }).lean();
    expect(stored.isInternalNote).toBe(false);
  });

  test('empty message is a 422', async () => {
    const t = await ticketWithStatus('Open');
    const res = await reply(t.ticketNumber, { body: '   ' });
    expectError(res, 422, 'VALIDATION_ERROR');
    expect(fieldsOf(res)).toEqual(['body']);
  });
});

describe('role gate', () => {
  test('admins cannot create tickets or reply as an author', async () => {
    expectError(await post('/api/v1/tickets', adminToken, validTicket()), 403, 'FORBIDDEN');
    expectError(
      await post(`/api/v1/tickets/${world.priyaTicket.ticketNumber}/messages`, adminToken, { body: 'hi' }),
      403,
      'FORBIDDEN',
    );
  });
});
