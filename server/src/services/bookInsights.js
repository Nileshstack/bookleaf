/**
 * Derived, read-only facts about a book, computed from BookLeaf policy (see
 * the knowledge base). Pure functions with no DB access, so the author API
 * and the AI prompt builder can share them and both quote the same numbers
 * and dates.
 */

export const PUBLISHED_STATUS = 'Published & Live';

export const PRODUCTION_STAGES = Object.freeze([
  'Manuscript Received',
  'Editing',
  'Cover Design',
  'Typesetting',
  'Proofreading',
  'ISBN Assignment',
  'Printing',
  'Distribution Setup',
  PUBLISHED_STATUS,
]);

export const ROYALTY_POLICY = Object.freeze({
  payoutThreshold: 1000, // ₹; smaller balances roll over to the next quarter
  payoutDaysAfterQuarterEnd: 45,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);

export const isPublished = (book) => book.status === PUBLISHED_STATUS;

/**
 * The next payout deadline on BookLeaf's calendar: royalties are calculated
 * per quarter and paid within 45 days of the quarter ending. On 3 Nov 2026,
 * for example, the next deadline is 14 Nov 2026 (for the quarter ending
 * 30 Sep). This is a schedule date, not a promise that a given balance will
 * be paid then.
 */
export const nextScheduledPayout = (now = new Date()) => {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // Starting a year back covers deadlines that fall early in this year for last year's Q4.
  for (let year = now.getUTCFullYear() - 1; year <= now.getUTCFullYear() + 1; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const quarterEnd = Date.UTC(year, quarter * 3, 0); // day 0 = last day of the previous month
      const payoutBy = quarterEnd + ROYALTY_POLICY.payoutDaysAfterQuarterEnd * DAY_MS;
      if (payoutBy >= today) return { quarterEnd: toISODate(quarterEnd), payoutBy: toISODate(payoutBy) };
    }
  }
  return null; // unreachable: a deadline always falls within the scanned range
};

const payoutStatusOf = ({ earned, paid, pending }) => {
  if (earned === 0) return 'no_earnings_yet';
  if (pending === 0) return 'fully_paid';
  if (paid === 0) return 'awaiting_first_payout';
  return 'partially_paid';
};

/**
 * Everything the "My Books" royalty column needs, so the client doesn't
 * re-implement policy. For books in production every money field is null,
 * not 0: the book has no price yet, which is different from earning nothing.
 */
export const royaltyBreakdown = (book, now = new Date()) => {
  if (!isPublished(book)) {
    return {
      payoutStatus: 'not_yet_published',
      royaltyPerCopy: null,
      copiesSold: null,
      totalEarned: null,
      paid: null,
      pending: null,
      paidPercentage: null,
      meetsPayoutThreshold: null,
      rollsOverToNextQuarter: null,
      payoutThreshold: ROYALTY_POLICY.payoutThreshold,
      lastPayoutDate: null,
      nextScheduledPayout: null,
    };
  }

  const earned = book.totalRoyaltyEarned ?? 0;
  const paid = book.royaltyPaid ?? 0;
  const pending = book.royaltyPending ?? 0;

  return {
    payoutStatus: payoutStatusOf({ earned, paid, pending }),
    royaltyPerCopy: book.royaltyPerCopy,
    copiesSold: book.totalCopiesSold ?? 0,
    totalEarned: earned,
    paid,
    pending,
    paidPercentage: earned > 0 ? Math.round((paid / earned) * 100) : null,
    meetsPayoutThreshold: pending >= ROYALTY_POLICY.payoutThreshold,
    rollsOverToNextQuarter: pending > 0 && pending < ROYALTY_POLICY.payoutThreshold,
    payoutThreshold: ROYALTY_POLICY.payoutThreshold,
    lastPayoutDate: book.lastRoyaltyPayoutDate ? toISODate(new Date(book.lastRoyaltyPayoutDate).getTime()) : null,
    nextScheduledPayout: pending > 0 ? nextScheduledPayout(now) : null,
  };
};

/** Where the book is in the production pipeline, e.g. "Cover Design", step 3 of 9. */
export const productionProgress = (book) => {
  const currentStage = isPublished(book)
    ? PUBLISHED_STATUS
    : book.status.replace(/^In Production\s*-\s*/i, '').trim();
  const index = PRODUCTION_STAGES.findIndex((s) => s.toLowerCase() === currentStage.toLowerCase());

  return {
    currentStage,
    stepNumber: index === -1 ? null : index + 1, // null for a status we don't recognise
    totalSteps: PRODUCTION_STAGES.length,
    stages: PRODUCTION_STAGES,
  };
};
