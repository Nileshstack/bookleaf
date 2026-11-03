import { jest } from '@jest/globals';
import request from 'supertest';

// Replace the AI triage service before anything imports it: first it fails
// the way a real outage would, then it hangs forever.
const classifyTicket = jest.fn();
jest.unstable_mockModule('../src/services/triage.service.js', () => ({ classifyTicket }));

const { createApp } = await import('../src/app.js');
const { Ticket } = await import('../src/models/index.js');
const { closeTestDB, connectTestDB } = await import('./helpers/db.js');
const { bearer, createWorld, loginAs } = await import('./helpers/fixtures.js');

const app = createApp();
let token;

const flushBackgroundTasks = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeAll(async () => {
  await connectTestDB('ai_decoupling');
  await createWorld();
  token = await loginAs(app, 'priya.sharma@email.com');
});

afterAll(closeTestDB);

const createTicket = () =>
  request(app)
    .post('/api/v1/tickets')
    .set(bearer(token))
    .send({ subject: 'Bank details update', description: 'I changed banks. How do I update my payout account?' });

test('ticket creation succeeds and persists when the AI service throws', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  classifyTicket.mockRejectedValueOnce(Object.assign(new Error('OpenAI 503 Service Unavailable'), { status: 503 }));

  const res = await createTicket();
  expect(res.status).toBe(201);

  await flushBackgroundTasks();
  expect(classifyTicket).toHaveBeenCalledWith(expect.anything());
  expect(String(classifyTicket.mock.calls.at(-1)[0])).toBe(res.body.data._id);

  const saved = await Ticket.findById(res.body.data._id).lean();
  expect(saved).toMatchObject({ status: 'Open', aiStatus: 'pending' });

  // The failure is logged, not swallowed silently and not crashing the process.
  expect(consoleError.mock.calls.flat().join(' ')).toMatch(/Background task failed: classify-ticket/);
  consoleError.mockRestore();
});

test('ticket creation does not wait for a slow or hung AI call', async () => {
  classifyTicket.mockImplementationOnce(() => new Promise(() => {})); // never settles

  const started = Date.now();
  const res = await createTicket();

  expect(res.status).toBe(201);
  expect(Date.now() - started).toBeLessThan(2000);
});
