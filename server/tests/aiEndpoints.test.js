import { jest } from '@jest/globals';
import request from 'supertest';

/**
 * End-to-end AI flows through the real app, DB and services. Only the
 * OpenAI SDK is replaced. Retries are off and the breaker threshold is high,
 * so each test controls exactly what "OpenAI" returns.
 */
const create = jest.fn();
jest.unstable_mockModule('openai', () => ({
  default: class FakeOpenAI {
    constructor() {
      this.chat = { completions: { create } };
    }
  },
}));

process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.AI_MAX_RETRIES = '0';
process.env.AI_BREAKER_THRESHOLD = '100';
process.env.AI_CLASSIFY_ON_CREATE = 'true';

const { createApp } = await import('../src/app.js');
const { AiDraft, AiUsageLog, Book, Ticket } = await import('../src/models/index.js');
const { classifyTicket } = await import('../src/services/triage.service.js');
const { closeTestDB, connectTestDB } = await import('./helpers/db.js');
const { bearer, createWorld, loginAs } = await import('./helpers/fixtures.js');

const app = createApp();
let world;
let adminToken;
let priyaToken;

const completion = (content, usage = { prompt_tokens: 800, completion_tokens: 150, total_tokens: 950 }) => ({
  model: 'gpt-4o-mini-2024-07-18',
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage,
});
const upstreamDown = () => Object.assign(new Error('Service Unavailable'), { status: 503, headers: new Headers() });

const CLASSIFICATION = JSON.stringify({
  category: 'Royalty & Payments',
  priority: 'Critical',
  reasoning: 'Author has a large pending royalty and no payout for many months.',
  confidence: 0.91,
});
const DRAFT = 'Hi Priya,\n\nThank you for your patience. Your pending ₹3,570 is scheduled for payout.\n\nWarm regards,\nTeam BookLeaf';

/** Default fake: JSON-mode requests are classifications, everything else is a draft. */
const behaveNormally = () =>
  create.mockImplementation(async (params) => completion(params.response_format ? CLASSIFICATION : DRAFT));

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i += 1) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met in time');
};

beforeAll(async () => {
  await connectTestDB('ai_endpoints');
  world = await createWorld();
  await Book.updateOne(
    { bookId: 'BK001' },
    { $set: { mrp: 399, royaltyPerCopy: 35, totalCopiesSold: 342, totalRoyaltyEarned: 11970, royaltyPaid: 8400, royaltyPending: 3570, publicationDate: new Date('2023-06-20'), lastRoyaltyPayoutDate: new Date('2025-10-15') } },
  );
  adminToken = await loginAs(app, 'admin@bookleaf.com');
  priyaToken = await loginAs(app, 'priya.sharma@email.com');
});

beforeEach(() => {
  create.mockReset();
  behaveNormally();
});

afterAll(closeTestDB);

const draftPath = (t, qs = '') => `/api/v1/admin/tickets/${t.ticketNumber}/draft${qs}`;
const postAdmin = (path, body = {}) => request(app).post(path).set(bearer(adminToken)).send(body);

describe('classification', () => {
  test('a new ticket is classified in the background: 201 first, AI fields after', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set(bearer(priyaToken))
      .send({ bookId: 'BK001', subject: 'Still waiting for royalty', description: "My last payout was months ago and I haven't been paid since." });
    expect(res.status).toBe(201);

    await waitFor(async () => (await Ticket.findById(res.body.data._id).lean()).aiStatus !== 'pending');
    const t = await Ticket.findById(res.body.data._id).lean();
    expect(t).toMatchObject({
      aiStatus: 'done',
      classificationSource: 'ai',
      aiCategory: 'Royalty & Payments',
      aiPriority: 'Critical',
      category: 'Royalty & Payments',
      priority: 'Critical',
      priorityRank: 0,
      aiConfidence: 0.91,
    });

    // The model saw account context but no knowledge base.
    const userMsg = create.mock.calls[0][0].messages[1].content;
    expect(userMsg).toContain('"royalty_pending_inr":3570');
    expect(userMsg).not.toContain('Royalty policy');
  });

  test('AI down: the ticket still gets a rule-based category/priority, aiStatus failed, labelled', async () => {
    create.mockRejectedValue(upstreamDown());
    const t = await classifyTicket(world.rohitTicket._id, { force: true });

    expect(t).toMatchObject({
      aiStatus: 'failed',
      classificationSource: 'rules',
      aiCategory: null, // a rule guess is not an AI suggestion
      category: 'ISBN & Metadata Issues',
      priority: 'High',
    });
    expect(t.aiError).toMatch(/^UPSTREAM_ERROR/);
    expect(t.aiReasoning).toMatch(/^Rule-based fallback/);
  });

  test('invalid model output also falls back to rules', async () => {
    create.mockResolvedValue(completion('{"category":"Marketing","priority":"Whenever"}'));
    const t = await classifyTicket(world.rohitTicket._id, { force: true });
    expect(t).toMatchObject({ aiStatus: 'failed', classificationSource: 'rules' });
    expect(t.aiError).toMatch(/^INVALID_OUTPUT/);
  });

  test("re-classification never overwrites an admin's override, but records the AI's view", async () => {
    await request(app)
      .patch(`/api/v1/admin/tickets/${world.priyaTicket.ticketNumber}`)
      .set(bearer(adminToken))
      .send({ category: 'General Inquiry', priority: 'Low' });

    const res = await postAdmin(`/api/v1/admin/tickets/${world.priyaTicket.ticketNumber}/classify`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      category: 'General Inquiry',
      priority: 'Low',
      aiCategory: 'Royalty & Payments',
      aiPriority: 'Critical',
      categoryOverridden: true,
      priorityOverridden: true,
      classificationSource: 'ai',
    });
  });
});

describe('classification concurrency', () => {
  test('overlapping recovery runs (restarts, several instances) classify each pending ticket once', async () => {
    const { recoverPendingClassifications } = await import('../src/services/triage.service.js');
    await Ticket.updateMany({}, { $set: { aiStatus: 'pending', aiClaimedAt: null } });
    const pending = await Ticket.countDocuments({ aiStatus: 'pending' });
    // Slow responses widen the race window, like real API latency.
    create.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return completion(CLASSIFICATION);
    });

    await Promise.all([1, 2, 3, 4].map(() => recoverPendingClassifications({ olderThanMs: 0 })));

    expect(create).toHaveBeenCalledTimes(pending);
    expect(await Ticket.countDocuments({ aiStatus: 'done', aiClaimedAt: null })).toBe(pending);
  });

  test('a forced re-run while another classification holds the lease answers 409', async () => {
    await Ticket.updateOne({ _id: world.rohitTicket._id }, { $set: { aiClaimedAt: new Date() } });
    const res = await postAdmin(`/api/v1/admin/tickets/${world.rohitTicket.ticketNumber}/classify`);
    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
    await Ticket.updateOne({ _id: world.rohitTicket._id }, { $set: { aiClaimedAt: null } });
  });

  test('an expired lease from a crashed process can be taken over', async () => {
    await Ticket.updateOne(
      { _id: world.rohitTicket._id },
      { $set: { aiStatus: 'pending', aiClaimedAt: new Date(Date.now() - 5 * 60 * 1000) } },
    );
    const t = await classifyTicket(world.rohitTicket._id);
    expect(t).toMatchObject({ aiStatus: 'done', aiClaimedAt: null });
  });
});

describe('draft responses', () => {
  test('generates a draft from the real book data and caches it', async () => {
    const first = await postAdmin(draftPath(world.priyaTicket));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ draftText: DRAFT, cached: false, warnings: [], context: { sections: expect.any(Array) } });

    const user = create.mock.calls[0][0].messages[1].content;
    expect(user).toContain('Royalty earned ₹11,970 · paid ₹8,400 · pending ₹3,570');
    expect(user).toContain('Last payout: 15 October 2025');

    const second = await postAdmin(draftPath(world.priyaTicket));
    expect(second.body.data).toMatchObject({ draftText: DRAFT, cached: true });
    expect(create).toHaveBeenCalledTimes(1); // the cache hit made no API call
  });

  test('regenerate=true forces a new draft', async () => {
    await postAdmin(draftPath(world.priyaTicket));
    const res = await postAdmin(draftPath(world.priyaTicket, '?regenerate=true'));
    expect(res.body.data.cached).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('a new message in the thread invalidates the cached draft', async () => {
    await postAdmin(draftPath(world.priyaTicket)); // warm (cached from earlier tests)
    create.mockClear();

    await request(app)
      .post(`/api/v1/tickets/${world.priyaTicket.ticketNumber}/messages`)
      .set(bearer(priyaToken))
      .send({ body: 'Any update please?' });

    const res = await postAdmin(draftPath(world.priyaTicket));
    expect(res.body.data.cached).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].messages[1].content).toContain('Any update please?');
  });

  test('AI down: 503 with a clear message, a category template, and the last good draft', async () => {
    create.mockRejectedValue(upstreamDown());
    const res = await postAdmin(draftPath(world.priyaTicket, '?regenerate=true'));

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: expect.stringMatching(/write the reply manually/),
      reason: 'UPSTREAM_ERROR',
      fallback: {
        template: expect.stringMatching(/^Hi Priya,[\s\S]*Team BookLeaf$/),
        staleDraft: { draftText: DRAFT, generatedAt: expect.any(String) },
      },
    });

    // The admin can still reply manually: the non-AI path is untouched.
    const reply = await postAdmin(`/api/v1/admin/tickets/${world.priyaTicket.ticketNumber}/reply`, { body: 'Manual reply' });
    expect(reply.status).toBe(201);
  });

  // Regression (QA): before classification finished, drafts got the General
  // sections (company, metadata), so a royalty question had no royalty policy.
  test('an unclassified ticket is drafted with the sections its text points to', async () => {
    const t = await Ticket.create({
      authorId: world.priya._id,
      subject: 'Royalty seems too low',
      description: 'My royalty payment seems too low for the copies sold. How is it calculated?',
    });
    expect(t.category).toBeNull();
    const res = await postAdmin(draftPath(t));
    expect(res.body.data.context.sections).toEqual(['royalty']);
    expect(create.mock.calls[0][0].messages[1].content).toContain('## Royalty policy');
  });

  test('a draft quoting an amount not in the records comes back with a warning', async () => {
    create.mockResolvedValue(completion('Hi Priya,\n\nYou will get ₹9,999.\n\nWarm regards,\nTeam BookLeaf'));
    const res = await postAdmin(draftPath(world.priyaTicket, '?regenerate=true'));
    expect(res.body.data.warnings).toEqual([expect.stringContaining('₹9,999')]);
    expect((await AiDraft.findOne({ ticketId: world.priyaTicket._id }).lean()).warnings).toHaveLength(1);
  });

  test('validation: regenerate must be true/false; unknown ticket is 404', async () => {
    expect((await postAdmin(draftPath(world.priyaTicket, '?regenerate=yes'))).status).toBe(400);
    expect((await postAdmin('/api/v1/admin/tickets/BL-9999/draft')).status).toBe(404);
  });

  test('authors cannot request drafts', async () => {
    const res = await request(app).post(draftPath(world.priyaTicket)).set(bearer(priyaToken));
    expect(res.status).toBe(403);
  });
});

describe('usage reporting', () => {
  test('/admin/ai/usage summarises calls, failures, cache hits, tokens and cost', async () => {
    await waitFor(async () => (await AiUsageLog.countDocuments()) > 5); // usage rows are written asynchronously
    const res = await request(app).get('/api/v1/admin/ai/usage?days=7').set(bearer(adminToken));

    expect(res.status).toBe(200);
    const { totals, byFeature, client, pricing } = res.body.data;
    expect(byFeature.classify.success).toBeGreaterThanOrEqual(2);
    expect(byFeature.classify.error).toBeGreaterThanOrEqual(1);
    expect(byFeature.draft.cacheHits).toBeGreaterThanOrEqual(1);
    expect(byFeature.draft.cacheHitRate).toBeGreaterThan(0);
    expect(totals.promptTokens).toBeGreaterThan(0);
    // 800 prompt + 150 completion at $0.15 / $0.60 per 1M tokens = $0.00021 per successful call.
    expect(byFeature.classify.costUsd).toBeCloseTo(byFeature.classify.success * 0.00021, 6);
    expect(pricing).toEqual({ inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 });
    expect(client).toMatchObject({ enabled: true, circuit: 'closed', model: 'gpt-4o-mini' });
  });

  test('days is validated', async () => {
    expect((await request(app).get('/api/v1/admin/ai/usage?days=0').set(bearer(adminToken))).status).toBe(400);
  });
});
