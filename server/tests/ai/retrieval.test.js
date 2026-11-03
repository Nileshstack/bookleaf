import {
  buildAccountOverview,
  buildBookFacts,
  buildKnowledgeContext,
  buildRecentThread,
  estimateTokens,
  pickExample,
  renderFullKnowledgeBase,
} from '../../src/ai/retrieval.js';
import { CATEGORY_SECTIONS, KB_SECTIONS } from '../../src/ai/knowledgeBase.js';
import { TICKET_CATEGORIES } from '../../src/models/enums.js';

const NOW = new Date('2026-11-03T10:00:00Z');

const published = {
  bookId: 'BK005',
  title: 'Between Two Temples',
  genre: 'Historical Fiction',
  status: 'Published & Live',
  publicationDate: new Date('2024-07-05'),
  mrp: 425,
  royaltyPerCopy: 38,
  totalCopiesSold: 67,
  totalRoyaltyEarned: 2546,
  royaltyPaid: 0,
  royaltyPending: 2546,
  lastRoyaltyPayoutDate: null,
  printPartner: 'Epitome Books',
  availableOn: ['Amazon India', 'BookLeaf Store'],
};

describe('knowledge retrieval', () => {
  test('every category maps to sections that exist', () => {
    for (const category of TICKET_CATEGORIES) {
      expect(CATEGORY_SECTIONS[category].every((key) => KB_SECTIONS[key])).toBe(true);
    }
  });

  test('Royalty sends only the royalty section and one example, a fraction of the full KB', () => {
    const ctx = buildKnowledgeContext({ category: 'Royalty & Payments', text: "I haven't received any royalty" });

    expect(ctx.sections).toEqual(['royalty']);
    expect(ctx.knowledge).toContain('80% of the net profit');
    expect(ctx.knowledge).toContain('₹1,000');
    expect(ctx.knowledge).toContain('45 days');
    expect(ctx.knowledge).not.toContain('5–7 business days'); // printing
    expect(ctx.knowledge).not.toContain('unique ISBN'); // isbn
    expect(ctx.exampleId).toBe('royalty-not-received');

    const sent = estimateTokens(ctx.knowledge + ctx.example);
    const full = estimateTokens(renderFullKnowledgeBase());
    expect(sent / full).toBeLessThan(0.3);
  });

  test('picks the matching example when a category has several', () => {
    expect(pickExample('Royalty & Payments', 'My royalty seems too low for 200 copies').id).toBe('royalty-too-low');
    expect(pickExample('Printing & Quality', 'anything').id).toBe('print-quality');
  });

  test('unknown or missing category falls back to General', () => {
    expect(buildKnowledgeContext({ category: null, text: '' })).toMatchObject({ category: 'General Inquiry', sections: ['company', 'metadata'] });
  });
});

describe('book facts', () => {
  test('never-paid book: real numbers, threshold, next payout date from today, overdue flag', () => {
    const { text, amounts } = buildBookFacts(published, NOW);

    expect(text).toContain('Royalty earned ₹2,546 · paid ₹0 · pending ₹2,546');
    expect(text).toContain('Last payout: none yet');
    expect(text).toContain('above the ₹1,000 minimum');
    expect(text).toContain('Next scheduled payout deadline: 14 November 2026 (for the quarter ending 30 September 2026)');
    expect(text).toMatch(/OVERDUE CHECK: no payout for 27 months/);
    expect(text).toContain('Print partner: Epitome Books');
    expect(amounts).toEqual(expect.arrayContaining([425, 38, 2546, 0, 1000]));
  });

  test('pending below ₹1,000 explains the rollover and is not flagged overdue', () => {
    const { text } = buildBookFacts({ ...published, totalRoyaltyEarned: 850, royaltyPending: 850 }, NOW);
    expect(text).toContain('Pending ₹850 is below the ₹1,000 minimum, so it rolls over');
    expect(text).not.toContain('OVERDUE');
  });

  test('a recent payout is not flagged overdue', () => {
    const { text } = buildBookFacts({ ...published, royaltyPaid: 1000, royaltyPending: 1546, lastRoyaltyPayoutDate: new Date('2026-08-14') }, NOW);
    expect(text).not.toContain('OVERDUE');
  });

  test('book in production: stage info, no figures, explicit instruction not to quote royalty', () => {
    const { text, amounts } = buildBookFacts(
      { bookId: 'BK013', title: 'Midnight in Mysore', status: 'In Production - Cover Design', mrp: null, royaltyPerCopy: null },
      NOW,
    );
    expect(text).toContain('NOT YET PUBLISHED. Current production stage: Cover Design (step 3 of 9)');
    expect(text).toContain('Do not quote any royalty or sales figures');
    expect(text).not.toMatch(/₹/);
    expect(amounts).toEqual([]);
  });

  test('General query without a book gets a one-line-per-book overview', () => {
    const { text } = buildAccountOverview([published, { bookId: 'BK015', title: 'Raising Roots', status: 'In Production - Typesetting' }], NOW);
    expect(text).toContain('"Between Two Temples" (BK005): live; earned ₹2,546, paid ₹0, pending ₹2,546');
    expect(text).toContain('"Raising Roots" (BK015): not yet published, stage Typesetting');
  });
});

describe('thread window', () => {
  test('only the last 3 entries, internal notes labelled as context-only', () => {
    const messages = ['one', 'two', 'three', 'four'].map((body, i) => ({
      body,
      senderRole: i % 2 ? 'admin' : 'author',
      isInternalNote: body === 'three',
      createdAt: new Date(2026, 9, i + 1),
    }));
    const thread = buildRecentThread(messages, 3);
    expect(thread).not.toContain('one');
    expect(thread).toMatch(/\[INTERNAL NOTE \(facts only; never mention the note or repeat opinions\), [\d-]+\]\nthree/);
    expect(thread.match(/^\[/gm)).toHaveLength(3);
  });
});
