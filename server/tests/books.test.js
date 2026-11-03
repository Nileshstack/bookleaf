import request from 'supertest';
import { createApp } from '../src/app.js';
import { Book } from '../src/models/index.js';
import { nextScheduledPayout, productionProgress } from '../src/services/bookInsights.js';
import { expectError } from './helpers/assertions.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';
import { bearer, createWorld, loginAs } from './helpers/fixtures.js';

const app = createApp();
let world;
let priyaToken;

// Real shapes from the provided dataset, attached to Priya so one author covers every edge case.
const published = { status: 'Published & Live', mrp: 399, royaltyPerCopy: 35, publicationDate: new Date('2023-06-20') };

beforeAll(async () => {
  await connectTestDB('books');
  world = await createWorld();
  priyaToken = await loginAs(app, 'priya.sharma@email.com');

  await Book.updateOne(
    { bookId: 'BK001' },
    {
      $set: {
        ...published,
        totalCopiesSold: 342,
        totalRoyaltyEarned: 11970,
        royaltyPaid: 8400,
        royaltyPending: 3570,
        lastRoyaltyPayoutDate: new Date('2025-10-15'),
      },
    },
  );
  await Book.create([
    // like BK013: in production, every commercial field null
    { authorId: world.priya._id, bookId: 'BK013', title: 'Midnight in Mysore', isbn: 'isbn-13', status: 'In Production - Cover Design' },
    // like BK005: published, never paid
    { authorId: world.priya._id, bookId: 'BK005', title: 'Between Two Temples', isbn: 'isbn-05', ...published, totalCopiesSold: 67, totalRoyaltyEarned: 2546, royaltyPaid: 0, royaltyPending: 2546 },
    // like BK002: fully paid
    { authorId: world.priya._id, bookId: 'BK002', title: 'The Saffron Diaries', isbn: 'isbn-02', ...published, totalCopiesSold: 189, totalRoyaltyEarned: 7938, royaltyPaid: 7938, royaltyPending: 0 },
    // like BK016: pending below the ₹1,000 threshold
    { authorId: world.priya._id, bookId: 'BK016', title: 'The Nagpur Notebooks', isbn: 'isbn-16', ...published, totalCopiesSold: 34, totalRoyaltyEarned: 850, royaltyPaid: 0, royaltyPending: 850 },
    // published but no sales yet
    { authorId: world.priya._id, bookId: 'BK020', title: 'Fresh Release', isbn: 'isbn-20', ...published },
  ]);
});

afterAll(closeTestDB);

const getBooks = async () => {
  const res = await request(app).get('/api/v1/books').set(bearer(priyaToken));
  expect(res.status).toBe(200);
  return Object.fromEntries(res.body.data.map((b) => [b.bookId, b]));
};

describe('GET /api/v1/books', () => {
  test("returns only the author's books, each with derived fields", async () => {
    const books = await getBooks();
    expect(Object.keys(books).sort()).toEqual(['BK001', 'BK002', 'BK005', 'BK013', 'BK016', 'BK020']);
    for (const b of Object.values(books)) {
      expect(b).toHaveProperty('isPublished');
      expect(b).toHaveProperty('royaltyBreakdown');
      expect(b).toHaveProperty('production');
    }
  });

  test('book in production: null commercial fields, not zeros, plus its pipeline stage', async () => {
    const { BK013 } = await getBooks();

    expect(BK013).toMatchObject({ isPublished: false, mrp: null, royaltyPerCopy: null, publicationDate: null, availableOn: [] });
    expect(BK013.royaltyBreakdown).toMatchObject({
      payoutStatus: 'not_yet_published',
      totalEarned: null,
      pending: null,
      nextScheduledPayout: null,
    });
    expect(BK013.production).toMatchObject({ currentStage: 'Cover Design', stepNumber: 3, totalSteps: 9 });
  });

  test('partially paid book: percentage, last payout and next schedule', async () => {
    const { BK001 } = await getBooks();
    expect(BK001.isPublished).toBe(true);
    expect(BK001.royaltyBreakdown).toMatchObject({
      payoutStatus: 'partially_paid',
      totalEarned: 11970,
      paid: 8400,
      pending: 3570,
      paidPercentage: 70,
      meetsPayoutThreshold: true,
      rollsOverToNextQuarter: false,
      lastPayoutDate: '2025-10-15',
      nextScheduledPayout: { quarterEnd: expect.any(String), payoutBy: expect.any(String) },
    });
    expect(BK001.production).toMatchObject({ currentStage: 'Published & Live', stepNumber: 9 });
  });

  test('never-paid, fully-paid, below-threshold and no-sales books', async () => {
    const { BK005, BK002, BK016, BK020 } = await getBooks();

    expect(BK005.royaltyBreakdown).toMatchObject({ payoutStatus: 'awaiting_first_payout', paidPercentage: 0, lastPayoutDate: null });
    expect(BK002.royaltyBreakdown).toMatchObject({ payoutStatus: 'fully_paid', pending: 0, nextScheduledPayout: null });
    expect(BK016.royaltyBreakdown).toMatchObject({ meetsPayoutThreshold: false, rollsOverToNextQuarter: true });
    expect(BK020.royaltyBreakdown).toMatchObject({ payoutStatus: 'no_earnings_yet', paidPercentage: null, totalEarned: 0 });
  });
});

describe('GET /api/v1/books/:id', () => {
  test('own book by code or Mongo id', async () => {
    const byCode = await request(app).get('/api/v1/books/bk001').set(bearer(priyaToken));
    const byId = await request(app).get(`/api/v1/books/${world.priyaBook._id}`).set(bearer(priyaToken));
    expect(byCode.status).toBe(200);
    expect(byId.body.data.bookId).toBe('BK001');
    expect(byCode.body.data.royaltyBreakdown.payoutStatus).toBe('partially_paid');
  });

  test("another author's book is a 404", async () => {
    expectError(await request(app).get('/api/v1/books/BK003').set(bearer(priyaToken)), 404, 'NOT_FOUND');
  });
});

describe('bookInsights (policy maths)', () => {
  test.each([
    ['2026-11-03', '2026-09-30', '2026-11-14'], // inside the Q3 payout window
    ['2026-11-14', '2026-09-30', '2026-11-14'], // deadline day is inclusive
    ['2026-11-15', '2026-12-31', '2027-02-14'], // window passed, so the next quarter's
    ['2027-01-10', '2026-12-31', '2027-02-14'], // across the year boundary
    ['2024-04-01', '2024-03-31', '2024-05-15'],
  ])('on %s the next payout is for quarter ending %s, due by %s', (today, quarterEnd, payoutBy) => {
    expect(nextScheduledPayout(new Date(`${today}T10:00:00Z`))).toEqual({ quarterEnd, payoutBy });
  });

  test('unknown production status keeps the label with no step number', () => {
    expect(productionProgress({ status: 'In Production - Awaiting Contract' })).toMatchObject({
      currentStage: 'Awaiting Contract',
      stepNumber: null,
    });
  });
});
