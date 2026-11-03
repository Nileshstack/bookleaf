import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { createWorld, PASSWORD } from './helpers/fixtures.js';

/**
 * In production the session cookie is SameSite=None, so the browser attaches
 * it to cross-site requests. A page on another site could submit a plain HTML
 * form (no preflight) to a body-less POST such as assign-to-me. These tests
 * pin down that such requests are refused before any route runs.
 */
const app = createApp();
let world;
let cookie;

beforeAll(async () => {
  await connectTestDB('csrf');
  world = await createWorld();
  const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@bookleaf.com', password: PASSWORD }); // test world uses one password
  cookie = res.headers['set-cookie'];
});
afterAll(closeTestDB);

const assign = () => request(app).post(`/api/v1/admin/tickets/${world.priyaTicket.ticketNumber}/assign-to-me`).set('Cookie', cookie);

describe('cross-site requests with the session cookie', () => {
  test('a form post from another origin is refused and changes nothing', async () => {
    const res = await assign().set('Origin', 'https://evil.example').set('Content-Type', 'text/plain').send('x');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const ticket = await request(app).get(`/api/v1/admin/tickets/${world.priyaTicket.ticketNumber}`).set('Cookie', cookie);
    expect(ticket.body.data.assignedTo).toBeNull();
  });

  test('cookie-authenticated logout from another origin is refused', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  test('the allowed client origin, and clients without an Origin header, work', async () => {
    expect((await assign().set('Origin', 'http://localhost:3000')).status).toBe(200);
    expect((await assign()).status).toBe(200); // curl, Postman, server-to-server
  });
});
