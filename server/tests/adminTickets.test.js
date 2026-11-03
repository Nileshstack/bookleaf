import request from 'supertest';
import { createApp } from '../src/app.js';
import { Book, Ticket, TicketMessage, User } from '../src/models/index.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs, PASSWORD } from './helpers/fixtures.js';

const app = createApp();
const HOUR = 60 * 60 * 1000;

let world;
let adminToken;
let priyaToken;
let agent2;
const T = {}; // label -> ticket

/**
 * A fixed queue with known ages, so order and filters can be asserted exactly.
 *
 *   label  priority  status       age    author  category                      notes
 *   T1     Critical  Open         30h    priya   Royalty & Payments            overdue (>24h)
 *   T2     Critical  In Progress   2h    rohit   ISBN & Metadata Issues        assigned to admin
 *   T3     High      Open         60h    rohit   Distribution & Availability   overdue (>48h)
 *   T4     High      Open         10h    priya   Printing & Quality            assigned to agent2
 *   T5     Medium    Open        100h    priya   General Inquiry               overdue (>96h)
 *   T6     Low       Open          5h    rohit   General Inquiry
 *   T7     (none)    Open          1h    priya   (none)                        aiStatus failed
 *   T8     Critical  Resolved    200h    priya   Royalty & Payments            resolved: sorts last
 *   T9     Low       Closed      fixed   rohit   Book Status & Production      created 2025-01-15T18:00Z
 */
const SPEC = [
  ['T1', { priority: 'Critical', status: 'Open', hoursAgo: 30, author: 'priya', category: 'Royalty & Payments', subject: 'No royalty received for Whispers of the Ganges' }],
  ['T2', { priority: 'Critical', status: 'In Progress', hoursAgo: 2, author: 'rohit', category: 'ISBN & Metadata Issues', subject: 'Wrong ISBN on Amazon US', assign: 'admin' }],
  ['T3', { priority: 'High', status: 'Open', hoursAgo: 60, author: 'rohit', category: 'Distribution & Availability', subject: 'Currently unavailable on Flipkart' }],
  ['T4', { priority: 'High', status: 'Open', hoursAgo: 10, author: 'priya', category: 'Printing & Quality', subject: 'Blurry images in author copies', assign: 'agent2' }],
  ['T5', { priority: 'Medium', status: 'Open', hoursAgo: 100, author: 'priya', category: 'General Inquiry', subject: 'Update author bio' }],
  ['T6', { priority: 'Low', status: 'Open', hoursAgo: 5, author: 'rohit', category: 'General Inquiry', subject: 'Change my profile photo' }],
  ['T7', { priority: null, status: 'Open', hoursAgo: 1, author: 'priya', category: null, subject: 'Question about bank details', aiStatus: 'failed' }],
  ['T8', { priority: 'Critical', status: 'Resolved', hoursAgo: 200, author: 'priya', category: 'Royalty & Payments', subject: 'Old payout issue' }],
  ['T9', { priority: 'Low', status: 'Closed', createdAt: new Date('2025-01-15T18:00:00Z'), author: 'rohit', category: 'Book Status & Production Updates', subject: 'Cover approval question' }],
];

const QUEUE_ORDER = ['T1', 'T2', 'T3', 'T4', 'T5', 'T7', 'T6', 'T8', 'T9'];

beforeAll(async () => {
  await connectTestDB('admin_tickets');
  world = await createWorld();
  await Ticket.deleteMany({});
  await TicketMessage.deleteMany({});

  agent2 = await User.create({ role: 'admin', name: 'Agent Two', email: 'agent2@bookleaf.com', passwordHash: await User.hashPassword(PASSWORD) });
  await Book.updateOne({ bookId: 'BK001' }, { $set: { totalRoyaltyEarned: 11970, royaltyPaid: 8400, royaltyPending: 3570 } });

  const now = Date.now();
  const assignees = { admin: world.admin._id, agent2: agent2._id };
  // Created in order so ticket numbers are BL-0001..BL-0009 = T1..T9.
  for (const [label, s] of SPEC) {
    const ticket = await Ticket.create({
      authorId: world[s.author]._id,
      bookId: s.author === 'priya' && label === 'T1' ? world.priyaBook._id : null,
      subject: s.subject,
      description: `${s.subject}. Please help, this needs attention.`,
      status: s.status,
      priority: s.priority,
      category: s.category,
      aiStatus: s.aiStatus ?? 'done',
      assignedTo: s.assign ? assignees[s.assign] : null,
    });
    const createdAt = s.createdAt ?? new Date(now - s.hoursAgo * HOUR);
    // Raw collection write: sets an exact age without Mongoose timestamps interfering.
    await Ticket.collection.updateOne({ _id: ticket._id }, { $set: { createdAt, updatedAt: createdAt } });
    T[label] = ticket;
  }

  adminToken = await loginAs(app, 'admin@bookleaf.com');
  priyaToken = await loginAs(app, 'priya.sharma@email.com');
});

afterAll(closeTestDB);

const get = (path, token = adminToken) => request(app).get(path).set(bearer(token));
const send = (method, path, body, token = adminToken) => request(app)[method](path).set(bearer(token)).send(body);

const labelsOf = (res) => {
  const byNumber = Object.fromEntries(Object.entries(T).map(([label, t]) => [t.ticketNumber, label]));
  return res.body.data.map((t) => byNumber[t.ticketNumber]);
};
const queue = async (qs = '') => {
  const res = await get(`/api/v1/admin/tickets?limit=100${qs}`);
  expect(res.status).toBe(200);
  return labelsOf(res);
};

describe('GET /admin/tickets: default sort', () => {
  test('unresolved first, then most urgent, then oldest; Resolved/Closed last', async () => {
    expect(await queue()).toEqual(QUEUE_ORDER);
  });

  test('an unclassified ticket sorts with Medium (after older Medium, before Low)', async () => {
    const order = await queue();
    expect(order.indexOf('T7')).toBeGreaterThan(order.indexOf('T5'));
    expect(order.indexOf('T7')).toBeLessThan(order.indexOf('T6'));
  });

  test('pagination is stable and reports totals', async () => {
    const res = await get('/api/v1/admin/tickets?limit=2&page=2');
    expect(labelsOf(res)).toEqual(['T3', 'T4']);
    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 9, totalPages: 5 });
  });

  test.each([
    ['newest', ['T7', 'T2', 'T6', 'T4', 'T1', 'T3', 'T5', 'T8', 'T9']],
    ['oldest', ['T9', 'T8', 'T5', 'T3', 'T1', 'T4', 'T6', 'T2', 'T7']],
  ])('sort=%s', async (sort, expected) => {
    expect(await queue(`&sort=${sort}`)).toEqual(expected);
  });
});

describe('GET /admin/tickets: computed fields', () => {
  test('ageHours, slaHours and isOverdue follow the SLA per priority', async () => {
    const res = await get('/api/v1/admin/tickets?limit=100');
    const byLabel = Object.fromEntries(labelsOf(res).map((l, i) => [l, res.body.data[i]]));

    expect(byLabel.T1).toMatchObject({ ageHours: 30, slaHours: 24, isOverdue: true });
    expect(byLabel.T2).toMatchObject({ ageHours: 2, slaHours: 24, isOverdue: false });
    expect(byLabel.T3).toMatchObject({ slaHours: 48, isOverdue: true });
    expect(byLabel.T4).toMatchObject({ slaHours: 48, isOverdue: false });
    expect(byLabel.T5).toMatchObject({ slaHours: 96, isOverdue: true });
    expect(byLabel.T7).toMatchObject({ slaHours: 96, isOverdue: false }); // unclassified uses the Medium SLA
    expect(byLabel.T8).toMatchObject({ ageHours: 200, isOverdue: false }); // resolved is never overdue
  });

  test('admin view includes triage fields, author and assignee', async () => {
    const res = await get('/api/v1/admin/tickets?limit=100');
    const t2 = res.body.data.find((t) => t.ticketNumber === T.T2.ticketNumber);
    expect(t2).toMatchObject({
      priority: 'Critical',
      aiStatus: 'done',
      author: { name: 'Rohit Kapoor', authorCode: 'AUTH002' },
      assignedTo: { name: 'BookLeaf Support' },
      awaitingTeamResponse: true,
    });
  });
});

describe('GET /admin/tickets: filters', () => {
  test.each([
    ['status (single)', '&status=Open', ['T1', 'T3', 'T4', 'T5', 'T7', 'T6']],
    ['status (comma list)', '&status=Resolved,Closed', ['T8', 'T9']],
    ['status (repeated param)', '&status=In%20Progress&status=Resolved', ['T2', 'T8']],
    ['category', '&category=General%20Inquiry', ['T5', 'T6']],
    ['priority', '&priority=Critical', ['T1', 'T2', 'T8']],
    ['status + priority combined', '&status=Open&priority=High', ['T3', 'T4']],
    ['aiStatus', '&aiStatus=failed', ['T7']],
    ['authorId by author code', '&authorId=AUTH002', ['T2', 'T3', 'T6', 'T9']],
    ['unknown author code matches nothing', '&authorId=AUTH999', []],
    ['assignedTo=me', '&assignedTo=me', ['T2']],
    ['assignedTo=unassigned + Open', '&assignedTo=unassigned&status=Open', ['T1', 'T3', 'T5', 'T7', 'T6']],
    ['overdue=true', '&overdue=true', ['T1', 'T3', 'T5']],
    ['search by subject word', '&q=isbn', ['T2']],
    ['search by author name', '&q=rohit', ['T2', 'T3', 'T6', 'T9']],
    ['search by book title', '&q=ganges', ['T1']],
    ['search is literal, not regex', '&q=.*', []],
  ])('%s', async (_label, qs, expected) => {
    expect(await queue(qs)).toEqual(expected);
  });

  test('authorId and assignedTo accept Mongo ids', async () => {
    expect(await queue(`&authorId=${world.priya._id}&status=Resolved`)).toEqual(['T8']);
    expect(await queue(`&assignedTo=${agent2._id}`)).toEqual(['T4']);
  });

  test('search by ticket number', async () => {
    expect(await queue(`&q=${T.T5.ticketNumber}`)).toEqual(['T5']);
  });

  test('date range with ISO timestamps', async () => {
    const from = new Date(Date.now() - 70 * HOUR).toISOString();
    const to = new Date(Date.now() - 20 * HOUR).toISOString();
    expect(await queue(`&from=${from}&to=${to}`)).toEqual(['T1', 'T3']);
  });

  test('date-only "to" includes the whole day', async () => {
    expect(await queue('&from=2025-01-15&to=2025-01-15')).toEqual(['T9']);
    expect(await queue('&from=2025-01-16&to=2025-01-16')).toEqual([]);
  });

  test.each([
    ['unknown status', '?status=Pending', 'status'],
    ['unknown priority in a list', '?priority=High,Urgent', 'priority'],
    ['bad author ref', '?authorId=priya', 'authorId'],
    ['bad assignedTo', '?assignedTo=bob', 'assignedTo'],
    ['unparseable date', '?from=yesterday', 'from'],
    ['to before from', '?from=2025-02-01&to=2025-01-01', 'to'],
    ['limit above max', '?limit=500', 'limit'],
    ['unknown sort', '?sort=random', 'sort'],
  ])('rejects %s with 400 naming the field', async (_label, qs, field) => {
    const res = await get(`/api/v1/admin/tickets${qs}`);
    expectError(res, 400, 'VALIDATION_ERROR');
    // List filters point at the offending item, e.g. "priority.1" for the second value.
    expect(res.body.error.details.map((d) => d.field.split('.')[0])).toContain(field);
  });
});

describe('GET /admin/tickets/:id', () => {
  beforeAll(async () => {
    await TicketMessage.create([
      { ticketId: T.T1._id, senderRole: 'admin', senderId: world.admin._id, body: 'Checking with finance', isInternalNote: true },
      { ticketId: T.T1._id, senderRole: 'admin', senderId: world.admin._id, body: 'We are looking into this' },
    ]);
  });

  test('full detail: thread with internal notes, author profile, book insights, other open tickets', async () => {
    const res = await get(`/api/v1/admin/tickets/${T.T1.ticketNumber}`);
    expect(res.status).toBe(200);
    const d = res.body.data;

    expect(d).toMatchObject({ ticketNumber: T.T1.ticketNumber, priority: 'Critical', isOverdue: true, ageHours: 30 });
    expect(d.messages.map((m) => [m.body, m.isInternalNote])).toEqual([
      ['Checking with finance', true],
      ['We are looking into this', false],
    ]);
    expect(d.authorProfile).toMatchObject({
      name: 'Priya Sharma',
      authorCode: 'AUTH001',
      books: { total: 1, totalRoyaltyEarned: 11970, royaltyPaid: 8400, royaltyPending: 3570 },
      tickets: { total: 5, unresolved: 4 },
    });
    expect(d.book).toMatchObject({ bookId: 'BK001', royaltyBreakdown: { pending: 3570 } });
    // Priya's other unresolved tickets: T4, T5, T7, in queue order.
    expect(d.otherOpenTickets.count).toBe(3);
    expect(d.otherOpenTickets.items.map((t) => t.ticketNumber)).toEqual([T.T4, T.T5, T.T7].map((t) => t.ticketNumber));
  });

  test('General ticket has book: null; unknown ticket is 404', async () => {
    expect((await get(`/api/v1/admin/tickets/${T.T5.ticketNumber}`)).body.data.book).toBeNull();
    expectError(await get('/api/v1/admin/tickets/BL-9999'), 404, 'NOT_FOUND');
  });
});

describe('PATCH /admin/tickets/:id', () => {
  const patch = (ticket, body) => send('patch', `/api/v1/admin/tickets/${ticket.ticketNumber}`, body);

  test('category/priority override keeps the AI values and sets the flags; reverting clears them', async () => {
    await Ticket.updateOne({ _id: T.T6._id }, { $set: { aiCategory: 'General Inquiry', aiPriority: 'Low' } });

    const res = await patch(T.T6, { category: 'Royalty & Payments', priority: 'High' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      category: 'Royalty & Payments',
      aiCategory: 'General Inquiry',
      categoryOverridden: true,
      priority: 'High',
      aiPriority: 'Low',
      priorityOverridden: true,
    });
    // The new priority moves it up the queue (priorityRank kept in sync).
    const order = await queue('&status=Open');
    expect(order.indexOf('T6')).toBeLessThan(order.indexOf('T5'));

    const reverted = await patch(T.T6, { category: 'General Inquiry', priority: 'Low' });
    expect(reverted.body.data).toMatchObject({ categoryOverridden: false, priorityOverridden: false });
  });

  test('setting a value when the AI gave none marks it as a human decision', async () => {
    const res = await patch(T.T7, { category: 'Royalty & Payments', priority: 'Medium' });
    expect(res.body.data).toMatchObject({ aiCategory: null, categoryOverridden: true, priorityOverridden: true });
  });

  test('status change is visible to the author; assignment validates the assignee', async () => {
    const res = await patch(T.T5, { status: 'In Progress', assignedTo: String(agent2._id) });
    expect(res.body.data).toMatchObject({ status: 'In Progress', assignedTo: { name: 'Agent Two' } });

    const authorView = await get(`/api/v1/tickets/${T.T5.ticketNumber}`, priyaToken);
    expect(authorView.body.data.status).toBe('In Progress');

    const toAuthor = await patch(T.T5, { assignedTo: String(world.priya._id) });
    expectError(toAuthor, 422, 'VALIDATION_ERROR');
    expect(toAuthor.body.error.details[0].field).toBe('assignedTo');

    const unassign = await patch(T.T5, { assignedTo: null });
    expect(unassign.body.data.assignedTo).toBeNull();
  });

  test('rejects empty, unknown and invalid fields with 422', async () => {
    expectError(await patch(T.T5, {}), 422, 'VALIDATION_ERROR');

    const unknown = await patch(T.T5, { aiCategory: 'General Inquiry', status: 'Open' });
    expectError(unknown, 422, 'VALIDATION_ERROR');
    expect(unknown.body.error.details).toEqual([{ field: 'aiCategory', message: 'Unknown field' }]);

    const bad = await patch(T.T5, { priority: 'Urgent', status: 'Done' });
    expect(bad.body.error.details.map((d) => d.field).sort()).toEqual(['priority', 'status']);
  });
});

describe('assign-to-me, notes and replies', () => {
  test('assign-to-me takes the ticket and is idempotent', async () => {
    const path = `/api/v1/admin/tickets/${T.T4.ticketNumber}/assign-to-me`;
    const first = await send('post', path, {});
    expect(first.status).toBe(200);
    expect(first.body.data.assignedTo.name).toBe('BookLeaf Support');
    expect(String(first.body.data.previousAssigneeId)).toBe(String(agent2._id));

    const again = await send('post', path, {});
    expect(again.body.data.assignedTo.name).toBe('BookLeaf Support');
  });

  test('internal note is stored for admins and never shown to the author', async () => {
    const res = await send('post', `/api/v1/admin/tickets/${T.T5.ticketNumber}/notes`, { body: 'Author is VIP, handle with care' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isInternalNote: true, senderName: 'BookLeaf Support' });

    const authorView = await get(`/api/v1/tickets/${T.T5.ticketNumber}`, priyaToken);
    expect(JSON.stringify(authorView.body)).not.toContain('VIP');
  });

  test('reply reaches the author, records wasAiDrafted, moves Open to In Progress and self-assigns', async () => {
    const res = await send('post', `/api/v1/admin/tickets/${T.T1.ticketNumber}/reply`, {
      body: 'Hi Priya, your payout is being processed.',
      wasAiDrafted: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatchObject({ wasAiDrafted: true, isInternalNote: false });
    expect(res.body.data.ticket.status).toBe('In Progress');
    expect(String(res.body.data.ticket.assignedTo)).toBe(String(world.admin._id));

    const authorView = await get(`/api/v1/tickets/${T.T1.ticketNumber}`, priyaToken);
    const last = authorView.body.data.messages.at(-1);
    expect(last).toMatchObject({ senderRole: 'admin', body: 'Hi Priya, your payout is being processed.' });
    expect(last).not.toHaveProperty('wasAiDrafted');
  });

  test('reply can set the status in the same call', async () => {
    const res = await send('post', `/api/v1/admin/tickets/${T.T3.ticketNumber}/reply`, { body: 'Re-synced, live again.', status: 'Resolved' });
    expect(res.body.data.ticket.status).toBe('Resolved');
  });

  test('reply on a Closed ticket needs an explicit status to reopen it', async () => {
    const path = `/api/v1/admin/tickets/${T.T9.ticketNumber}/reply`;
    expectError(await send('post', path, { body: 'Following up' }), 409, 'TICKET_CLOSED');

    const reopened = await send('post', path, { body: 'Following up', status: 'In Progress' });
    expect(reopened.status).toBe(201);
    expect(reopened.body.data.ticket.status).toBe('In Progress');
  });

  test('note and reply bodies are validated', async () => {
    expectError(await send('post', `/api/v1/admin/tickets/${T.T1.ticketNumber}/notes`, { body: '' }), 422, 'VALIDATION_ERROR');
    expectError(
      await send('post', `/api/v1/admin/tickets/${T.T1.ticketNumber}/reply`, { body: 'ok', wasAiDrafted: 'yes' }),
      422,
      'VALIDATION_ERROR',
    );
  });
});

describe('GET /admin/stats', () => {
  test('counts by status/category/priority, open-ticket age and AI rates', async () => {
    const res = await get('/api/v1/admin/stats');
    expect(res.status).toBe(200);
    const s = res.body.data;

    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(s.total).toBe(9);
    expect(sum(s.byStatus)).toBe(9);
    expect(sum(s.byCategory)).toBe(9);
    expect(sum(s.byPriority)).toBe(9);
    expect(Object.keys(s.byPriority)).toEqual(['Critical', 'High', 'Medium', 'Low', 'Unclassified']);

    expect(s.unresolved.count).toBe(s.byStatus.Open + s.byStatus['In Progress']);
    expect(s.unresolved.averageAgeHours).toEqual(expect.any(Number));
    // Open-queue breakdowns only count Open / In Progress tickets.
    expect(sum(s.unresolved.byPriority)).toBe(s.unresolved.count);
    expect(sum(s.unresolved.byCategory)).toBe(s.unresolved.count);
    expect(s.unresolved.byPriority.Critical).toBeLessThan(s.byPriority.Critical);

    // Only T6 had AI suggestions, and it was reverted, so 0 of 1 overridden.
    expect(s.ai.category).toEqual({ suggested: 1, overridden: 0, overrideRate: 0 });
    // Admin replies: T1 (AI-drafted), T3, T9 and the seeded T1 reply.
    expect(s.ai.drafts).toMatchObject({ aiDrafted: 1 });
    expect(s.ai.drafts.repliesSent).toBeGreaterThanOrEqual(3);
  });
});

describe('access', () => {
  test.each([
    ['get', '/api/v1/admin/tickets'],
    ['get', '/api/v1/admin/stats'],
    ['patch', '/api/v1/admin/tickets/BL-0001'],
    ['post', '/api/v1/admin/tickets/BL-0001/reply'],
  ])('author on %s %s gets 403; anonymous gets 401', async (method, path) => {
    expectError(await request(app)[method](path).set(bearer(priyaToken)).send({}), 403, 'FORBIDDEN');
    expectError(await request(app)[method](path).send({}), 401, 'UNAUTHORIZED');
  });
});
