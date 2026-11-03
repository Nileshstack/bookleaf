import { jest } from '@jest/globals';
import { datesIn, generateDraft, postProcessDraft } from '../../src/ai/drafter.js';
import { AiOutputError } from '../../src/ai/errors.js';
import { fallbackTemplate } from '../../src/ai/templates.js';

const NOW = new Date('2026-11-03T10:00:00Z');
const REPLY = 'Hi Ananya,\n\nI am sorry. Your pending ₹2,546 is overdue.\n\nWarm regards,\nTeam BookLeaf';

const fakeClient = (content = REPLY, finishReason = 'stop') => ({
  complete: jest.fn(async () => ({ content, finishReason, model: 'gpt-4o-mini', usage: { promptTokens: 900, completionTokens: 180, totalTokens: 1080 } })),
});

const author = { name: 'Ananya Reddy', joinedDate: new Date('2024-02-20') };
const book = {
  bookId: 'BK005',
  title: 'Between Two Temples',
  status: 'Published & Live',
  publicationDate: new Date('2024-07-05'),
  mrp: 425,
  royaltyPerCopy: 38,
  totalCopiesSold: 67,
  totalRoyaltyEarned: 2546,
  royaltyPaid: 0,
  royaltyPending: 2546,
  printPartner: 'Epitome Books',
  availableOn: ['Amazon India', 'BookLeaf Store'],
};
const ticket = {
  _id: 't5',
  ticketNumber: 'BL-0005',
  status: 'Open',
  category: 'Royalty & Payments',
  subject: 'Never received any royalty',
  description: 'I have not received a single royalty payment.',
};
const messages = ['m1', 'm2', 'm3', 'm4'].map((body, i) => ({ body, senderRole: 'author', createdAt: new Date(2026, 9, 28 + i) }));

describe('generateDraft', () => {
  test('prompt has the tone rules, the KB sections, only this book, today, and the last 3 messages', async () => {
    const client = fakeClient();
    const otherBook = { ...book, bookId: 'BK999', title: 'Some Other Book' };

    const draft = await generateDraft({ ticket, book, author, authorBooks: [otherBook], messages, now: NOW }, { client });

    const req = client.complete.mock.calls[0][0];
    expect(req).toMatchObject({ feature: 'draft', temperature: 0.4, maxTokens: 450 });
    const [system, user] = req.messages;

    expect(system.content).toContain("Acknowledge the author's concern before moving to solutions.");
    expect(system.content).toMatch(/Never invent amounts, dates/);
    expect(system.content).toMatch(/Warm regards,\nTeam BookLeaf$/);

    expect(user.content).toContain('TODAY: 2026-11-03');
    expect(user.content).toContain('Royalty earned ₹2,546 · paid ₹0 · pending ₹2,546');
    expect(user.content).toContain('Next scheduled payout deadline: 14 November 2026');
    expect(user.content).toContain('OVERDUE CHECK');
    expect(user.content).toContain('## Royalty policy');
    expect(user.content).not.toContain('## Printing and quality');
    expect(user.content).not.toContain('Some Other Book'); // only the referenced book
    expect(user.content).not.toContain('\nm1'); // only the last 3 messages
    expect(user.content).toContain('m4');

    expect(draft).toMatchObject({
      text: REPLY,
      warnings: [],
      context: { category: 'Royalty & Payments', sections: ['royalty'], exampleId: 'royalty-not-received', threadEntries: 3 },
    });
  });

  test('book in production: the prompt carries stage info and an explicit no-figures instruction', async () => {
    const client = fakeClient('Hi Sneha,\n\nYour book is in cover design.\n\nWarm regards,\nTeam BookLeaf');
    const inProduction = { bookId: 'BK013', title: 'Midnight in Mysore', status: 'In Production - Cover Design', mrp: null };
    await generateDraft(
      { ticket: { ...ticket, category: 'Book Status & Production Updates' }, book: inProduction, author, messages: [], now: NOW },
      { client },
    );
    const user = client.complete.mock.calls[0][0].messages[1].content;
    expect(user).toContain('Cover Design (step 3 of 9)');
    expect(user).toContain('Do not quote any royalty or sales figures');
    expect(user).toContain('No replies yet');
  });

  test('General ticket without a book uses the account overview', async () => {
    const client = fakeClient();
    await generateDraft({ ticket: { ...ticket, category: 'General Inquiry' }, book: null, author, authorBooks: [book], messages: [], now: NOW }, { client });
    expect(client.complete.mock.calls[0][0].messages[1].content).toContain('Account overview (all books)');
  });
});

test('drafts ask for an interactive budget (1 retry, 12 s per attempt)', async () => {
  const client = fakeClient();
  await generateDraft({ ticket, book, author, messages: [], now: NOW }, { client });
  expect(client.complete.mock.calls[0][0]).toMatchObject({ feature: 'draft', retries: 1, timeout: 12_000 });
});

describe('postProcessDraft guard rails', () => {
  test('appends the sign-off if the model forgot it', () => {
    expect(postProcessDraft('Hi Ananya,\n\nThanks.', { allowedAmounts: [] }).text).toMatch(/Warm regards,\nTeam BookLeaf$/);
  });

  test('flags ₹ amounts that are not in the facts or the conversation', () => {
    const { warnings } = postProcessDraft('You will receive ₹3,000 and ₹2,546.\n\nWarm regards,\nTeam BookLeaf', { allowedAmounts: [2546] });
    expect(warnings).toEqual([expect.stringContaining('₹3,000')]);
    expect(warnings[0]).not.toContain('2,546');
  });

  // Regression (QA): a no-book draft promised payout by "November 30, 2026", a date in no fact.
  test('flags full dates that are not in the prompt, in any format', () => {
    const allowedDates = datesIn('Next scheduled payout deadline: 14 November 2026\nTODAY: 2026-11-03');
    const ok = postProcessDraft('Payout by November 14, 2026 (as of 3rd November 2026).', { allowedAmounts: [], allowedDates });
    expect(ok.warnings).toEqual([]);
    const bad = postProcessDraft('Payout by November 30, 2026.', { allowedAmounts: [], allowedDates });
    expect(bad.warnings).toEqual([expect.stringContaining('30 November 2026')]);
  });

  test('a real draft call checks dates against its own prompt', async () => {
    const client = fakeClient('Hi Ananya,\n\nWe will pay you by 30 November 2026.\n\nWarm regards,\nTeam BookLeaf');
    const draft = await generateDraft({ ticket, book: null, author, authorBooks: [book], messages: [], now: NOW }, { client });
    expect(draft.warnings).toEqual([expect.stringContaining('30 November 2026')]);
  });

  test('warns when the draft was cut off, and rejects empty output', () => {
    expect(postProcessDraft('Hi', { allowedAmounts: [], finishReason: 'length' }).warnings[0]).toMatch(/length limit/);
    expect(() => postProcessDraft('   ', { allowedAmounts: [] })).toThrow(AiOutputError);
  });
});

describe('fallback templates', () => {
  test('policy-only skeleton with the author name, ticket number and sign-off', () => {
    const text = fallbackTemplate({ category: 'Printing & Quality', authorName: 'Vikram Joshi', ticketNumber: 'BL-0003' });
    expect(text).toMatch(/^Hi Vikram,/);
    expect(text).toContain('5–7 business days');
    expect(text).toContain('(Ref: BL-0003)');
    expect(text).toMatch(/Team BookLeaf$/);
  });
});
