import { AiOutputError } from './errors.js';
import { buildDraftUserMessage, DRAFT_MAX_INPUT_CHARS, DRAFT_SYSTEM_PROMPT } from './prompts.js';
import {
  buildAccountOverview,
  buildAuthorLine,
  buildBookFacts,
  buildKnowledgeContext,
  buildRecentThread,
  estimateTokens,
  truncate,
} from './retrieval.js';

const SIGN_OFF = 'Warm regards,\nTeam BookLeaf';
const AMOUNT = /₹\s?(\d[\d,]*(?:\.\d+)?)/g;

const amountsIn = (text = '') => [...String(text).matchAll(AMOUNT)].map((m) => Number(m[1].replace(/,/g, '')));

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DAY_MONTH_YEAR = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)? (${MONTHS}),? (\d{4})\b`, 'g');
const MONTH_DAY_YEAR = new RegExp(String.raw`\b(${MONTHS}) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b`, 'g');
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** Full calendar dates ("14 November 2026", "November 14, 2026", "2026-11-14"), normalised to "2026-November-14". */
export const datesIn = (text = '') => [
  ...[...String(text).matchAll(ISO_DATE)].map(([, y, m, d]) => `${y}-${MONTHS.split('|')[Number(m) - 1]}-${Number(d)}`),
  ...[...String(text).matchAll(DAY_MONTH_YEAR)].map(([, d, m, y]) => `${y}-${m}-${Number(d)}`),
  ...[...String(text).matchAll(MONTH_DAY_YEAR)].map(([, m, d, y]) => `${y}-${m}-${Number(d)}`),
];
const displayDate = (key) => {
  const [y, m, d] = key.split('-');
  return `${d} ${m} ${y}`;
};

/**
 * Guard rails on the model's text. Nothing is rewritten silently except the
 * sign-off; anything doubtful becomes a warning for the reviewing admin.
 */
export const postProcessDraft = (raw, { allowedAmounts, allowedDates, finishReason }) => {
  let text = String(raw ?? '').trim().replace(/^#+\s.*$/gm, '').trim(); // drop stray markdown headings
  if (!text) throw new AiOutputError('Draft was empty');

  const warnings = [];
  if (finishReason === 'length') warnings.push('The draft hit the length limit and may be cut off. Check the ending.');

  if (!/Team BookLeaf\s*$/.test(text)) text = `${text}\n\n${SIGN_OFF}`;

  // Hallucination check: every ₹ amount in the draft must come from the facts or the conversation.
  const allowed = new Set(allowedAmounts);
  const unknown = [...new Set(amountsIn(text).filter((n) => !allowed.has(n)))];
  if (unknown.length) {
    warnings.push(
      `Mentions ${unknown.map((n) => `₹${n.toLocaleString('en-IN')}`).join(', ')}, which is not in this author's records. Verify before sending.`,
    );
  }

  // Same for full dates: every one must appear in the prompt. Skipped when the caller has no date list.
  if (allowedDates) {
    const known = new Set(allowedDates);
    const unknownDates = [...new Set(datesIn(text).filter((d) => !known.has(d)))];
    if (unknownDates.length) {
      warnings.push(`Mentions ${unknownDates.map(displayDate).join(', ')}, which is not in this ticket's facts. Verify before sending.`);
    }
  }

  return { text, warnings };
};

/**
 * Builds the prompt from three bounded inputs: the KB sections for the
 * category, the referenced book's real data, and the last 3 thread entries.
 *
 * @param input { ticket, book, author, authorBooks, messages, now }
 *   ticket.category should already be final (or AI-suggested); null falls back to General.
 * @returns { text, warnings, model, usage, context }
 * @throws AiUnavailableError | AiOutputError
 */
export const generateDraft = async ({ ticket, book, author, authorBooks = [], messages = [], now = new Date() }, { client }) => {
  const description = truncate(ticket.description, DRAFT_MAX_INPUT_CHARS);
  const kb = buildKnowledgeContext({ category: ticket.category, text: `${ticket.subject}\n${description}` });
  const facts = book ? buildBookFacts(book, now, { category: kb.category }) : buildAccountOverview(authorBooks, now);
  const { text: authorLine } = buildAuthorLine(author, now);

  const userMessage = buildDraftUserMessage({
    today: now.toISOString().slice(0, 10),
    ticket: { ...ticket, category: kb.category, description },
    authorLine,
    facts: facts.text,
    knowledge: kb.knowledge,
    example: kb.example,
    thread: buildRecentThread(messages, 3),
  });

  const response = await client.complete({
    feature: 'draft',
    ticketId: ticket._id,
    temperature: 0.4,
    maxTokens: 450,
    // An admin is waiting on this one: fail over to the template in ~25 s at
    // worst (QA: 3 × 15 s attempts on a hung upstream took ~47 s).
    retries: 1,
    timeout: 12_000,
    messages: [
      { role: 'system', content: DRAFT_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  });

  // Amounts the author or team already mentioned are fair to repeat.
  const conversationAmounts = [ticket.subject, ticket.description, ...messages.map((m) => m.body)].flatMap(amountsIn);
  const { text, warnings } = postProcessDraft(response.content, {
    allowedAmounts: [...facts.amounts, ...conversationAmounts, 1000],
    allowedDates: datesIn(userMessage),
    finishReason: response.finishReason,
  });

  return {
    text,
    warnings,
    model: response.model,
    usage: response.usage,
    context: {
      category: kb.category,
      sections: kb.sections,
      exampleId: kb.exampleId,
      threadEntries: Math.min(messages.length, 3),
      estimatedPromptTokens: estimateTokens(DRAFT_SYSTEM_PROMPT + userMessage),
    },
  };
};
