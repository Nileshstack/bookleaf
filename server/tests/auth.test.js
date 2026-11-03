import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/index.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs, PASSWORD } from './helpers/fixtures.js';

const app = createApp();
let world;

beforeAll(async () => {
  await connectTestDB('auth');
  world = await createWorld();
});

afterAll(closeTestDB);

describe('POST /api/v1/auth/login', () => {
  test('valid credentials set an httpOnly cookie and return the user without a password hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: '  Priya.Sharma@Email.com ', password: PASSWORD }); // trimmed + case-insensitive

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: 'priya.sharma@email.com', role: 'author', authorCode: 'AUTH001' });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.token).toEqual(expect.any(String));

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('bl_token='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  test('wrong password returns 401 INVALID_CREDENTIALS and sets no cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'priya.sharma@email.com', password: 'WrongPass@1' });

    expectError(res, 401, 'INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('unknown email gives the identical response, so accounts cannot be enumerated', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'priya.sharma@email.com', password: 'WrongPass@1' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@email.com', password: 'WrongPass@1' });

    expectError(unknownEmail, 401, 'INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  test('malformed body returns 422 with per-field details', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expectError(res, 422, 'VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
  });

  test('invalid JSON returns 400, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expectError(res, 400, 'BAD_REQUEST');
  });
});

describe('authentication on protected routes', () => {
  test('missing token returns 401 UNAUTHORIZED', async () => {
    for (const path of ['/api/v1/auth/me', '/api/v1/tickets', '/api/v1/books', '/api/v1/users']) {
      expectError(await request(app).get(path), 401, 'UNAUTHORIZED');
    }
  });

  test('tampered, wrongly-signed and expired tokens are rejected with 401', async () => {
    const token = await loginAs(app, 'priya.sharma@email.com');
    const tampered = `${token.slice(0, -2)}xx`;
    const wrongSecret = jwt.sign({ role: 'admin' }, 'some-other-secret-that-is-long-enough!!', {
      subject: String(world.priya._id),
    });
    const expired = jwt.sign({ role: 'author' }, process.env.JWT_SECRET, {
      subject: String(world.priya._id),
      expiresIn: -10,
    });

    for (const bad of [tampered, wrongSecret, expired]) {
      expectError(await request(app).get('/api/v1/auth/me').set(bearer(bad)), 401, 'UNAUTHORIZED');
    }
  });

  test('a valid token for a deleted account is rejected', async () => {
    const ghost = await User.create({
      role: 'author',
      name: 'Ghost',
      email: 'ghost@email.com',
      passwordHash: await User.hashPassword(PASSWORD),
    });
    const token = await loginAs(app, 'ghost@email.com');
    await ghost.deleteOne();

    expectError(await request(app).get('/api/v1/auth/me').set(bearer(token)), 401, 'UNAUTHORIZED');
  });

  test('GET /auth/me works with both the Bearer header and the cookie', async () => {
    const token = await loginAs(app, 'priya.sharma@email.com');

    const viaHeader = await request(app).get('/api/v1/auth/me').set(bearer(token));
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.data.user.email).toBe('priya.sharma@email.com');

    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'priya.sharma@email.com', password: PASSWORD });
    const viaCookie = await agent.get('/api/v1/auth/me');
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.data.user.email).toBe('priya.sharma@email.com');
  });

  test('logout clears the cookie, so the same agent is no longer authenticated', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'priya.sharma@email.com', password: PASSWORD });

    const res = await agent.post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/bl_token=;/);

    expectError(await agent.get('/api/v1/auth/me'), 401, 'UNAUTHORIZED');
  });
});
