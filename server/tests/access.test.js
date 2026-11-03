import request from 'supertest';
import { createApp } from '../src/app.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs } from './helpers/fixtures.js';

const app = createApp();
let world;
let priyaToken;
let adminToken;

beforeAll(async () => {
  await connectTestDB('access');
  world = await createWorld();
  priyaToken = await loginAs(app, 'priya.sharma@email.com');
  adminToken = await loginAs(app, 'admin@bookleaf.com', 'Author@123');
});

afterAll(closeTestDB);

const get = (path, token) => request(app).get(path).set(bearer(token));

describe('author ownership', () => {
  test("author accessing another author's ticket gets 404, identical to a non-existent ticket", async () => {
    const othersById = await get(`/api/v1/tickets/${world.rohitTicket._id}`, priyaToken);
    const othersByNumber = await get(`/api/v1/tickets/${world.rohitTicket.ticketNumber}`, priyaToken);
    const nonexistent = await get('/api/v1/tickets/BL-9999', priyaToken);

    expectError(othersById, 404, 'NOT_FOUND');
    expectError(othersByNumber, 404, 'NOT_FOUND');
    expectError(nonexistent, 404, 'NOT_FOUND');
    // Same message too: nothing distinguishes "exists but not yours".
    expect(othersById.body.error.message).toBe(nonexistent.body.error.message);
  });

  test('author can read their own ticket, without internal notes or triage fields', async () => {
    const res = await get(`/api/v1/tickets/${world.priyaTicket.ticketNumber}`, priyaToken);

    expect(res.status).toBe(200);
    expect(res.body.data.ticketNumber).toBe(world.priyaTicket.ticketNumber);
    expect(res.body.data.messages.map((m) => m.body)).toEqual(['Public reply to Priya']);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    for (const internal of ['priority', 'aiPriority', 'aiReasoning', 'assignedTo', 'isInternalNote']) {
      expect(JSON.stringify(res.body)).not.toContain(`"${internal}"`);
    }
  });

  test('ticket list only ever contains the author\'s own tickets', async () => {
    const res = await get('/api/v1/tickets', priyaToken);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.ticketNumber)).toEqual([world.priyaTicket.ticketNumber]);
    expect(res.body.meta.total).toBe(1);
  });

  test("author cannot read another author's book (404), but can read their own", async () => {
    expectError(await get('/api/v1/books/BK003', priyaToken), 404, 'NOT_FOUND');

    const own = await get('/api/v1/books/BK001', priyaToken);
    expect(own.status).toBe(200);
    expect(own.body.data.title).toBe('Whispers of the Ganges');

    const list = await get('/api/v1/books', priyaToken);
    expect(list.body.data.map((b) => b.bookId)).toEqual(['BK001']);
  });

  test('malformed ticket reference returns 400 with details', async () => {
    const res = await get('/api/v1/tickets/not-a-ticket', priyaToken);
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('ticketId');
  });

  test('invalid query filter returns 400', async () => {
    expectError(await get('/api/v1/tickets?status=Pending', priyaToken), 400, 'VALIDATION_ERROR');
  });
});

describe('role-based access', () => {
  test('author hitting an admin-only route gets 403 FORBIDDEN', async () => {
    expectError(await get('/api/v1/users', priyaToken), 403, 'FORBIDDEN');
  });

  test('admin can use admin routes and sees every ticket, including internal notes', async () => {
    const users = await get('/api/v1/users?role=author', adminToken);
    expect(users.status).toBe(200);
    expect(users.body.data).toHaveLength(2);
    expect(JSON.stringify(users.body)).not.toContain('passwordHash');

    const tickets = await get('/api/v1/tickets', adminToken);
    // Queue order: High (Rohit) before Medium (Priya).
    expect(tickets.body.data.map((t) => t.ticketNumber)).toEqual([
      world.rohitTicket.ticketNumber,
      world.priyaTicket.ticketNumber,
    ]);

    const detail = await get(`/api/v1/tickets/${world.priyaTicket._id}`, adminToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.priority).toBe('Medium');
    expect(detail.body.data.messages.find((m) => m.isInternalNote).body).toBe('SECRET internal note');
  });

  test('authenticated request to an unknown route gets a JSON 404', async () => {
    expectError(await get('/api/v1/nope', priyaToken), 404, 'NOT_FOUND');
  });
});
