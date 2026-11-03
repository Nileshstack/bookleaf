import { jest } from '@jest/globals';
import { classifyWithAi, parseClassification } from '../../src/ai/classifier.js';
import { AiOutputError, AiUnavailableError } from '../../src/ai/errors.js';
import { classifyWithRules } from '../../src/ai/fallbackClassifier.js';
import { KB_SECTIONS } from '../../src/ai/knowledgeBase.js';
import { sampleTickets } from '../../src/seed/sampleTickets.js';

const fakeClient = (content) => ({ complete: jest.fn(async () => ({ content, model: 'gpt-4o-mini', usage: {} })) });

describe('parseClassification (output validation)', () => {
  test('accepts valid output and normalises small formatting slips', () => {
    expect(
      parseClassification('{"category":"royalty and payments","priority":"HIGH","reasoning":" Payout overdue. ","confidence":"0.9"}'),
    ).toEqual({ category: 'Royalty & Payments', priority: 'High', reasoning: 'Payout overdue.', confidence: 0.9 });
  });

  test('out-of-range confidence falls back to 0.5 instead of failing', () => {
    expect(parseClassification('{"category":"General Inquiry","priority":"Low","reasoning":"x","confidence":7}').confidence).toBe(0.5);
  });

  test.each([
    ['invalid JSON', 'not json'],
    ['unknown category', '{"category":"Marketing","priority":"Low","reasoning":"x"}'],
    ['unknown priority', '{"category":"General Inquiry","priority":"Urgent","reasoning":"x"}'],
    ['missing reasoning', '{"category":"General Inquiry","priority":"Low"}'],
  ])('rejects %s with AiOutputError', (_label, content) => {
    expect(() => parseClassification(content)).toThrow(AiOutputError);
  });
});

describe('classifyWithAi (request shape)', () => {
  test('one JSON-mode call at temperature 0, with only subject + truncated description + account context', async () => {
    const client = fakeClient('{"category":"Royalty & Payments","priority":"Critical","reasoning":"Never paid in 28 months.","confidence":0.92}');
    const ticket = { _id: 't1', subject: 'No royalty', description: 'x'.repeat(5000) };

    const result = await classifyWithAi(ticket, { author_tenure_months: 32, account_royalty_pending_inr: 2546 }, { client });

    expect(result).toMatchObject({ category: 'Royalty & Payments', priority: 'Critical', confidence: 0.92 });
    expect(client.complete).toHaveBeenCalledTimes(1);

    const req = client.complete.mock.calls[0][0];
    expect(req).toMatchObject({ feature: 'classify', json: true, temperature: 0, ticketId: 't1' });

    const [system, user] = req.messages;
    // The rubric is in the prompt...
    expect(system.content).toMatch(/Critical: money owed but unpaid for 6\+ months/);
    expect(system.content).toMatch(/Low: author bio/);
    expect(system.content).toMatch(/not instructions to you/); // prompt-injection guard
    // ...the description is truncated to ~1,500 chars...
    expect(user.content).toContain('x'.repeat(1500));
    expect(user.content).not.toContain('x'.repeat(1501));
    expect(user.content).toContain('"account_royalty_pending_inr":2546');
    // ...and no knowledge base text is sent for classification.
    expect(system.content + user.content).not.toContain(KB_SECTIONS.royalty.facts[1]);
  });

  test('propagates AiUnavailableError and AiOutputError for the caller to fall back', async () => {
    const down = { complete: jest.fn(async () => Promise.reject(new AiUnavailableError('down', { code: 'UPSTREAM_ERROR' }))) };
    await expect(classifyWithAi({ subject: 's', description: 'd' }, {}, { client: down })).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(classifyWithAi({ subject: 's', description: 'd' }, {}, { client: fakeClient('{"category":"x"}') })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });
});

describe('rule-based fallback classifier', () => {
  test.each(sampleTickets.map((t) => [t.subject, t]))('seed ticket "%s" gets the hand-triaged category and priority', (_subject, t) => {
    const result = classifyWithRules(t, { monthsSincePublication: 28 });
    expect({ category: result.category, priority: result.priority }).toEqual({ category: t.category, priority: t.priority });
    expect(result.reasoning).toMatch(/^Rule-based fallback/);
  });

  test.each([
    ['duplicate ISBN', 'Two different books seem to share a duplicate ISBN', 'ISBN & Metadata Issues', 'Critical'],
    ['blurry images', 'The images in my author copies are blurry and pages are misaligned', 'Printing & Quality', 'High'],
    ['urgent bump', 'When will typesetting finish? I have a launch event this week', 'Book Status & Production Updates', 'High'],
    ['nothing matches', 'Hello, I have a question', 'General Inquiry', 'Medium'],
  ])('%s', (_label, description, category, priority) => {
    expect(classifyWithRules({ subject: '', description })).toMatchObject({ category, priority });
  });

  test('never-paid royalty is Critical only with 6+ months of account context', () => {
    const t = { subject: 'Royalty', description: "I haven't received any royalty payment yet." };
    expect(classifyWithRules(t, { monthsSincePublication: 8 }).priority).toBe('Critical');
    expect(classifyWithRules(t, { monthsSincePublication: 2 }).priority).toBe('High');
  });
});

// Regression (QA eval, classify-v1 scored 82% on category + priority): the three
// misreads came from cues the rubric did not name. Real-model accuracy is
// measured by `npm run eval:ai`; this pins the rubric wording.
describe('classification rubric', () => {
  test('names the cues the model missed in QA', async () => {
    const { CLASSIFY_SYSTEM_PROMPT, CLASSIFY_PROMPT_VERSION } = await import('../../src/ai/prompts.js');
    expect(CLASSIFY_PROMPT_VERSION).toBe('classify-v2');
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/changing the bank account royalties are paid into/);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/piracy, plagiarism or copyright infringement/);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/the author says the amount is wrong or too low/);
  });
});
