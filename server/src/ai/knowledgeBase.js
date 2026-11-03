/**
 * The BookLeaf Knowledge Base, transcribed from the assignment brief into
 * structured, sectioned data so retrieval can send only what a ticket needs.
 *
 * This file is also the single source of truth for policy numbers used
 * elsewhere: services/bookInsights.js imports ROYALTY_POLICY and
 * PRODUCTION_STAGES from here, so the API and the AI quote the same values.
 *
 * Bump KB_VERSION whenever content changes. It is part of the draft cache
 * key, so cached drafts built on old policy are regenerated.
 */

export const KB_VERSION = '2026-11-03.1';

export const ROYALTY_POLICY = Object.freeze({
  authorSharePercent: 80,
  bookleafSharePercent: 20,
  payoutThreshold: 1000, // ₹; below this, royalties roll over to the next quarter
  payoutDaysAfterQuarterEnd: 45,
});

export const PRODUCTION_STAGES = Object.freeze([
  'Manuscript Received',
  'Editing',
  'Cover Design',
  'Typesetting',
  'Proofreading',
  'ISBN Assignment',
  'Printing',
  'Distribution Setup',
  'Published & Live',
]);

export const SALES_PLATFORMS = Object.freeze(['Amazon India', 'Flipkart', 'Amazon US', 'Amazon UK', 'BookLeaf Store']);

/** Each section is a short title plus atomic facts, one line each when rendered. */
export const KB_SECTIONS = Object.freeze({
  company: {
    title: 'Company overview',
    facts: [
      'BookLeaf Publishing is a self-publishing company operating in India and the US.',
      'Publishing packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).',
      'BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution, and royalty management for its authors.',
      'The in-house printing facility and warehouse are in Delhi. Print partners include Repro India and Epitome Books.',
    ],
  },
  royalty: {
    title: 'Royalty policy',
    facts: [
      `Royalty split is ${ROYALTY_POLICY.authorSharePercent}/${ROYALTY_POLICY.bookleafSharePercent}: ${ROYALTY_POLICY.authorSharePercent}% of the net profit per book goes to the author, ${ROYALTY_POLICY.bookleafSharePercent}% to BookLeaf.`,
      'Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart), and shipping charges.',
      `Royalties are calculated quarterly and paid within ${ROYALTY_POLICY.payoutDaysAfterQuarterEnd} days of the quarter ending.`,
      `Minimum payout threshold is ₹${ROYALTY_POLICY.payoutThreshold.toLocaleString('en-IN')}. If accumulated royalties are below this, they roll over to the next quarter.`,
      "Payouts are made by bank transfer to the account linked in the author's dashboard.",
      'Authors can see a detailed royalty breakdown in their dashboard, with sales figures per platform.',
    ],
  },
  isbn: {
    title: 'ISBN policy',
    facts: [
      'Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf.',
      "ISBNs are registered under BookLeaf's publisher imprint. An author who wants an ISBN under their own imprint must obtain it independently.",
      'A reported ISBN error (duplicate, wrong book linked) is treated as high priority and escalated to the production team.',
    ],
  },
  metadata: {
    title: 'Metadata and listing updates',
    facts: [
      'Metadata updates (e.g. book description, author bio) can be submitted through the dashboard or by emailing the BookLeaf team, including after the book is live.',
      'Metadata changes typically reflect on platforms within 3–5 business days.',
    ],
  },
  printing: {
    title: 'Printing and quality',
    facts: [
      'In-house printing handles most orders. Overflow or specific format requirements go to Repro India or Epitome Books.',
      'Standard print turnaround is 5–7 business days from order confirmation.',
      'For a quality issue (misprints, binding defects, colour inconsistency), BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.',
    ],
  },
  distribution: {
    title: 'Distribution and availability',
    facts: [
      `Books are listed on ${SALES_PLATFORMS.join(', ')}.`,
      'New listings typically go live within 7–10 business days after publication is complete.',
      "A book showing as unavailable on a platform usually means a stock sync issue. BookLeaf's team can trigger a re-sync, which takes 24–48 hours.",
    ],
  },
  production: {
    title: 'Production stages',
    facts: [
      `Stages in order: ${PRODUCTION_STAGES.join(' → ')} (Editing only if opted).`,
      'Authors are updated by email at each stage.',
      'Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).',
    ],
  },
});

/** Always included in drafting prompts: how BookLeaf sounds. */
export const TONE_GUIDELINES = Object.freeze([
  'Always empathetic and professional. Authors are partners, not customers to be managed.',
  "Acknowledge the author's concern before moving to solutions.",
  'Be specific: use actual numbers, dates and statuses instead of vague reassurances.',
  "If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.",
  'If the issue needs escalation or investigation, give a clear timeline (e.g. "Our team will look into this and get back to you within 48 hours") rather than open-ended promises.',
  'Always end with a clear next step for the author and/or the BookLeaf team.',
]);

/**
 * The brief's sample query → expected-handling pairs. Retrieval picks one per
 * ticket as a few-shot example. These are handling guidance, not reply text
 * to copy, so the model follows the approach without parroting it.
 */
export const EXAMPLES = Object.freeze([
  {
    id: 'royalty-not-received',
    category: 'Royalty & Payments',
    match: /not received|haven'?t received|no royalt|never (been )?paid|still waiting|when.*(paid|payout)|payout date/i,
    query: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
    guidance:
      "Acknowledge the frustration. Explain the quarterly royalty cycle and the 45-day payout window. Check whether their bank details are linked. Give the specific next payout date. If the payment is genuinely overdue, escalate with a 48-hour resolution timeline.",
  },
  {
    id: 'royalty-too-low',
    category: 'Royalty & Payments',
    match: /too low|less than|only (received|got)|seems (low|wrong)|calculat|breakdown|doesn'?t add up/i,
    query: 'My royalty amount seems too low. I sold 200 copies but only received ₹3,000.',
    guidance:
      "Explain the net profit calculation: MRP minus printing, platform commission and shipping. Offer to share a detailed line-by-line royalty breakdown. Don't be defensive; offer transparency.",
  },
  {
    id: 'isbn-mismatch',
    category: 'ISBN & Metadata Issues',
    query: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
    guidance:
      'Treat it as high priority. Acknowledge this is a serious data issue. Confirm it is being escalated to the production team immediately. Give a 48-hour resolution timeline.',
  },
  {
    id: 'print-quality',
    category: 'Printing & Quality',
    query: 'I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.',
    guidance:
      'Apologise sincerely. Ask the author to share photos of the defective copies. Confirm BookLeaf will arrange a free reprint once verified. Give a timeline of 5–7 business days for the reprint.',
  },
  {
    id: 'unavailable-listing',
    category: 'Distribution & Availability',
    query: 'My book is published but it\'s showing as "Currently Unavailable" on Amazon.',
    guidance:
      "Explain that this is typically a stock sync issue. Confirm you're triggering a re-sync with the distribution team. Set the expectation: 24–48 hours for it to go live again.",
  },
  {
    id: 'production-delay',
    category: 'Book Status & Production Updates',
    query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
    guidance:
      "Check the actual production status. If it's delayed, be honest about why (e.g. waiting on author approval for proofs). Give a specific updated timeline. Don't blame the author even if the delay is on their side; frame it collaboratively.",
  },
  {
    id: 'general-metadata-update',
    category: 'General Inquiry',
    query: 'Can I update the description of my book on Amazon after it\'s already live?',
    guidance:
      'Yes: metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.',
  },
]);

/** Which sections each category needs. Everything else is left out of the prompt. */
export const CATEGORY_SECTIONS = Object.freeze({
  'Royalty & Payments': ['royalty'],
  'ISBN & Metadata Issues': ['isbn', 'metadata'],
  'Printing & Quality': ['printing'],
  'Distribution & Availability': ['distribution'],
  'Book Status & Production Updates': ['production', 'distribution'],
  'General Inquiry': ['company', 'metadata'],
});

export const DEFAULT_CATEGORY = 'General Inquiry';
