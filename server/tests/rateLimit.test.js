import request from 'supertest';
import { createApp } from '../src/app.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { createWorld, PASSWORD } from './helpers/fixtures.js';

// Own file: the limiter's in-memory counter is module state, and Jest gives
// each test file a fresh module registry. Other suites therefore can't eat
// into this budget.
const app = createApp();

beforeAll(async () => {
  await connectTestDB('ratelimit');
  await createWorld();
});

afterAll(closeTestDB);

const attempt = (password) =>
  request(app).post('/api/v1/auth/login').send({ email: 'priya.sharma@email.com', password });

test('successful logins do not count toward the limit', async () => {
  for (let i = 0; i < 12; i++) expect((await attempt(PASSWORD)).status).toBe(200);
});

test('the 11th failed login within the window is blocked with 429, even with the right password', async () => {
  for (let i = 0; i < 10; i++) expect((await attempt('wrong')).status).toBe(401);

  expectError(await attempt('wrong'), 429, 'RATE_LIMITED');
  expectError(await attempt(PASSWORD), 429, 'RATE_LIMITED');
});
