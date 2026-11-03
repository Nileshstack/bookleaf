import {
  CATEGORY_SECTIONS,
  DEFAULT_CATEGORY,
  EXAMPLES,
  KB_SECTIONS,
  PRODUCTION_STAGES,
  ROYALTY_POLICY,
  TONE_GUIDELINES,
} from './knowledgeBase.js';
import {
  isPublished,
  monthsBetween,
  nextScheduledPayout,
  payoutAppearsOverdue,
  productionProgress,
  royaltyBreakdown,
} from '../services/bookInsights.js';

/**
 * Cost-aware context building. Each prompt gets only:
 *  - the KB sections mapped to the ticket's category (1–2 of 7),
 *  - one matching few-shot example (of 7),
 *  - the referenced book's facts (not the author's whole catalogue),
 *  - the last 3 thread entries (not the full history).
 * The tone guidelines are fixed text and live in the system prompt.
 */

export const estimateTokens = (text) => Math.ceil(text.length / 4); // rough for English; good enough for budgeting

export const truncate = (text = '', max) => {
  const clean = String(text).trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()} …[truncated]` : clean;
};

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const longDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthYear = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const renderSection = (key) => {
  const { title, facts } = KB_SECTIONS[key];
  return [`## ${title}`, ...facts.map((f) => `- ${f}`)].join('\n');
};

export const renderToneGuidelines = () => TONE_GUIDELINES.map((g) => `- ${g}`).join('\n');

/** The whole KB as one block; used only to measure what retrieval saves. */
export const renderFullKnowledgeBase = () =>
  [...Object.keys(KB_SECTIONS).map(renderSection), renderToneGuidelines(), ...EXAMPLES.map(renderExample)].join('\n\n');

function renderExample(example) {
  return `Author asked: "${example.query}"\nGood handling: ${example.guidance}`;
}

/** Picks the one example for the category; among several, the one whose pattern matches the ticket text. */
export const pickExample = (category, text = '') => {
  const candidates = EXAMPLES.filter((e) => e.category === category);
  return candidates.find((e) => e.match?.test(text)) ?? candidates[0] ?? null;
};

export const buildKnowledgeContext = ({ category, text }) => {
  const resolved = CATEGORY_SECTIONS[category] ? category : DEFAULT_CATEGORY;
  const sections = CATEGORY_SECTIONS[resolved];
  const example = pickExample(resolved, text);
  return {
    category: resolved,
    sections,
    exampleId: example?.id ?? null,
    knowledge: sections.map(renderSection).join('\n\n'),
    example: example ? renderExample(example) : '',
  };
};

/**
 * Facts about the referenced book, built only from stored data plus
 * policy-derived values (next payout date, threshold, overdue check). Every
 * number the model may quote is also returned in `amounts`, so the draft can
 * be checked for invented figures afterwards.
 */
export const buildBookFacts = (book, now = new Date(), { category } = {}) => {
  if (!book) return { text: 'Book: none selected (General / Account Level query).', amounts: [] };

  const lines = [`Book: "${book.title}" (${book.bookId})${book.genre ? `, ${book.genre}` : ''}`];
  const amounts = [];

  if (!isPublished(book)) {
    const progress = productionProgress(book);
    lines.push(
      `Status: NOT YET PUBLISHED. Current production stage: ${progress.currentStage}` +
        (progress.stepNumber ? ` (step ${progress.stepNumber} of ${progress.totalSteps})` : ''),
      `Production pipeline: ${PRODUCTION_STAGES.join(' → ')}`,
      'No MRP, sales or royalty exist yet because the book is not published. Do not quote any royalty or sales figures.',
      'No stage dates or expected completion date are on record here.',
    );
    return { text: lines.join('\n'), amounts };
  }

  const r = royaltyBreakdown(book, now);
  amounts.push(book.mrp, book.royaltyPerCopy, r.totalEarned, r.paid, r.pending, ROYALTY_POLICY.payoutThreshold);

  lines.push(
    `Status: Published & Live${book.publicationDate ? ` since ${longDate(book.publicationDate)}` : ''}`,
    `MRP ${inr(book.mrp)} · author royalty ${inr(book.royaltyPerCopy)} per copy · ${r.copiesSold} copies sold`,
    `Royalty earned ${inr(r.totalEarned)} · paid ${inr(r.paid)} · pending ${inr(r.pending)}`,
    `Last payout: ${r.lastPayoutDate ? longDate(r.lastPayoutDate) : 'none yet'}`,
  );

  if (r.totalEarned === 0) lines.push('No copies sold yet, so no royalty has been earned.');
  else if (r.pending === 0) lines.push('All earned royalty has been paid; nothing is pending.');
  else if (r.rollsOverToNextQuarter) {
    lines.push(
      `Pending ${inr(r.pending)} is below the ${inr(ROYALTY_POLICY.payoutThreshold)} minimum, so it rolls over to the next quarter until the balance reaches ${inr(ROYALTY_POLICY.payoutThreshold)}.`,
    );
  } else {
    lines.push(`Pending ${inr(r.pending)} is above the ${inr(ROYALTY_POLICY.payoutThreshold)} minimum, so it is eligible for payout.`);
  }

  // Payout timing and the overdue directive only for money questions. On an ISBN
  // or printing ticket they made the model change the subject to royalties.
  const aboutMoney = !category || category === 'Royalty & Payments' || category === 'General Inquiry';
  if (!aboutMoney) {
    lines.push('This ticket is not about royalties: do not bring up payouts or royalty amounts unless the author asks.');
  } else if (r.pending > 0) {
    const next = nextScheduledPayout(now);
    lines.push(
      `Next scheduled payout deadline: ${longDate(next.payoutBy)} (for the quarter ending ${longDate(next.quarterEnd)})`,
    );
  }

  // A rule in the system prompt alone was not enough: in QA the model quoted only the pending figure.
  if (category === 'Royalty & Payments' && r.totalEarned > 0) {
    lines.push(
      `BREAKDOWN (the reply must state all four figures): ${r.copiesSold.toLocaleString('en-IN')} copies sold, ${inr(r.totalEarned)} earned, ${inr(r.paid)} paid, ${inr(r.pending)} pending.`,
    );
  }

  if (aboutMoney && payoutAppearsOverdue(book, now)) {
    const since = book.lastRoyaltyPayoutDate ?? book.publicationDate;
    lines.push(
      `OVERDUE CHECK: no payout for ${monthsBetween(since, now)} months while the balance is above the threshold, so this looks overdue under the quarterly policy. Own the delay and escalate with a 48-hour resolution timeline.`,
    );
  }

  lines.push(
    `Print partner: ${book.printPartner ?? 'not recorded'}`,
    `Available on: ${book.availableOn?.length ? book.availableOn.join(', ') : 'no platforms recorded'}`,
  );

  return { text: lines.join('\n'), amounts: amounts.filter((n) => typeof n === 'number') };
};

/**
 * General tickets have no referenced book, so the model gets a one-line-per-
 * book overview instead: enough to answer "where is my money?" without
 * sending every field of every book.
 */
export const buildAccountOverview = (books = [], now = new Date()) => {
  if (!books.length) return { text: 'Account overview: no books on record.', amounts: [] };
  const amounts = [ROYALTY_POLICY.payoutThreshold];
  let totalPending = 0;
  const lines = books.map((b) => {
    if (!isPublished(b)) return `- "${b.title}" (${b.bookId}): not yet published, stage ${productionProgress(b).currentStage}`;
    const r = royaltyBreakdown(b, now);
    amounts.push(r.totalEarned, r.paid, r.pending);
    totalPending += r.pending;
    const lastPayout = r.lastPayoutDate ? `last payout ${longDate(r.lastPayoutDate)}` : 'never paid';
    const overdue = payoutAppearsOverdue(b, now) ? '; payout looks OVERDUE under the quarterly policy' : '';
    return `- "${b.title}" (${b.bookId}): live; earned ${inr(r.totalEarned)}, paid ${inr(r.paid)}, pending ${inr(r.pending)}, ${lastPayout}${overdue}`;
  });

  // Without these the model fills in payout dates itself (seen in QA: "November 30, 2026").
  if (totalPending > 0) {
    amounts.push(totalPending);
    const next = nextScheduledPayout(now);
    lines.push(
      `Total pending across books: ${inr(totalPending)} (minimum payout ${inr(ROYALTY_POLICY.payoutThreshold)}; smaller balances roll over to the next quarter)`,
      `Next scheduled payout deadline: ${longDate(next.payoutBy)} (for the quarter ending ${longDate(next.quarterEnd)})`,
    );
  }
  return { text: ['Account overview (all books):', ...lines].join('\n'), amounts };
};

export const buildAuthorLine = (author, now = new Date()) => {
  const firstName = author?.name?.split(/\s+/)[0] ?? 'there';
  const since = author?.joinedDate ? `, with BookLeaf since ${monthYear(author.joinedDate)} (${monthsBetween(author.joinedDate, now)} months)` : '';
  return { firstName, text: `Author: ${author?.name ?? 'Unknown'} (address them as "${firstName}")${since}` };
};

/** Last N thread entries, oldest first, each truncated. Internal notes are labelled as context-only. */
export const buildRecentThread = (messages = [], limit = 3, maxChars = 600) => {
  const recent = messages.slice(-limit);
  if (!recent.length) return 'No replies yet. This is the first response.';
  return recent
    .map((m) => {
      const who = m.isInternalNote
        ? 'INTERNAL NOTE (facts only; never mention the note or repeat opinions)'
        : m.senderRole === 'admin'
          ? 'BookLeaf team'
          : 'Author';
      return `[${who}, ${new Date(m.createdAt).toISOString().slice(0, 10)}]\n${truncate(m.body, maxChars)}`;
    })
    .join('\n\n');
};
