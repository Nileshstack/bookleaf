/**
 * Deterministic triage used when the AI is unavailable or returns junk.
 * Keyword rules are blunt next to the model, but they are instant, free,
 * and good enough to get a ticket into the right part of the queue. Every
 * result is labelled as a rule-based fallback so admins know to double-check.
 */

// [pattern, weight]: specific signals (3) beat topic words (2), which beat
// incidental mentions (1). Without weights, "my ISBN differs on the Amazon
// listing" would score Distribution (amazon + listing) above ISBN.
const CATEGORY_RULES = [
  {
    category: 'ISBN & Metadata Issues',
    patterns: [[/\bisbn\b/i, 3], [/\bmetadata\b/i, 2], [/wrong (title|author name|book)/i, 2], [/\bimprint\b/i, 2]],
  },
  {
    category: 'Royalty & Payments',
    patterns: [[/royalt/i, 3], [/\bpay(ment|out)s?\b/i, 2], [/\bpaid\b/i, 1], [/bank (account|details|transfer)/i, 2], [/\b(earning|statement)s?\b/i, 1], [/₹\s?\d/, 1]],
  },
  {
    category: 'Printing & Quality',
    patterns: [
      [/blurr|misalign|misprint|binding|\bbound\b|smudg|faded/i, 3],
      [/\bpages?\b.*(missing|upside|torn|loose)|upside down/i, 3],
      [/defect|reprint|print quality/i, 3],
      [/author cop(y|ies)/i, 2],
      [/colou?r (issue|inconsisten)/i, 2],
      [/\bprint(ing|ed)?\b/i, 1],
    ],
  },
  {
    category: 'Distribution & Availability',
    patterns: [
      [/unavailable|not available|out of stock/i, 3],
      [/(can'?t|cannot|couldn'?t) (find|order|buy)/i, 2],
      [/\blisting\b/i, 1],
      [/\b(amazon|flipkart)\b/i, 1],
      [/bookleaf store/i, 1],
    ],
  },
  {
    category: 'Book Status & Production Updates',
    patterns: [
      [/cover (design|draft)|typesett|proofread/i, 3],
      [/\b(editing|production|manuscript|proofs?)\b/i, 2],
      [/when will (it|my book) be (done|published|ready|live)/i, 2],
      [/\bstuck\b/i, 1],
    ],
  },
  {
    category: 'General Inquiry',
    patterns: [[/\b(bio|biography|profile|description|package)\b/i, 2], [/\bcan i\b|\bhow (do|can) i\b|\bis it possible\b/i, 1]],
  },
];

const CATEGORY_ORDER = CATEGORY_RULES.map((r) => r.category);

const PRIORITY_RULES = [
  { priority: 'Critical', test: (t) => /duplicate isbn|isbn.*(duplicate|wrong book)|wrong book.*isbn/i.test(t) },
  { priority: 'Critical', test: (t) => /(hack|unauthori[sz]ed|account (access|compromised)|copyright|plagiar|legal)/i.test(t) },
  {
    priority: 'Critical',
    test: (t, ctx) =>
      /royalt|pay/i.test(t) &&
      /(never|not|haven'?t|no)\b.*(receiv|paid|got)|single (royalty|payment)/i.test(t) &&
      (ctx.monthsSinceLastPayout ?? ctx.monthsSincePublication ?? 0) >= 6,
  },
  { priority: 'High', test: (t) => /isbn.*(different|mismatch|wrong|incorrect)|(different|wrong|incorrect).*isbn/i.test(t) },
  { priority: 'High', test: (t) => /blurr|misalign|misprint|binding|defect|upside down|torn|coming (away|off)/i.test(t) },
  { priority: 'High', test: (t) => /unavailable|not available|out of stock|can'?t (order|buy)/i.test(t) },
  { priority: 'High', test: (t) => /(never|not|haven'?t)\b.*(receiv|paid).*royalt|royalt.*(never|not|haven'?t)\b.*(receiv|paid)/i.test(t) },
  { priority: 'Low', test: (t) => /\b(bio|biography|profile photo|author photo|headshot)\b/i.test(t) },
];

const ESCALATION_SIGNAL = /\burgent|\basap\b|immediately|deadline|\blaunch|\bevent\b|this week|next week|tomorrow/i;
const BUMP = { Low: 'Medium', Medium: 'High', High: 'High', Critical: 'Critical' };

/**
 * @param ticket { subject, description }
 * @param accountContext { monthsSinceLastPayout?, monthsSincePublication? } from the referenced book
 * @returns { category, priority, reasoning, confidence, matched }
 */
export const classifyWithRules = (ticket, accountContext = {}) => {
  const text = `${ticket.subject ?? ''}\n${ticket.description ?? ''}`;

  // Weighted keyword score per category; ties go to the earlier (more specific) rule.
  const scored = CATEGORY_RULES.map((rule) => {
    const hits = rule.patterns.filter(([pattern]) => pattern.test(text));
    return { category: rule.category, hits: hits.map(([p]) => p.source), score: hits.reduce((s, [, w]) => s + w, 0) };
  }).sort((a, b) => b.score - a.score || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  const best = scored[0].score > 0 ? scored[0] : { category: 'General Inquiry', hits: [], score: 0 };

  let priority = PRIORITY_RULES.find((r) => r.test(text, accountContext))?.priority ?? 'Medium';
  const escalated = priority !== 'Critical' && ESCALATION_SIGNAL.test(text);
  if (escalated) priority = BUMP[priority];

  const signals = best.hits.length ? `matched ${best.hits.length} ${best.category} keyword(s)` : 'no category keywords matched';
  return {
    category: best.category,
    priority,
    reasoning: `Rule-based fallback: ${signals}${escalated ? '; urgency wording raised priority' : ''}.`,
    // Honest low confidence: these are keyword guesses.
    confidence: best.score >= 5 ? 0.6 : best.score >= 3 ? 0.45 : 0.2,
    matched: best.hits,
  };
};
