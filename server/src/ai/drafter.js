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

/**
 * Guard rails on the model's text. Nothing is rewritten silently except the
 * sign-off; anything doubtful becomes a warning for the reviewing admin.
 */
export const postProcessDraft = (raw, { allowedAmounts, finishReason }) => {
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
  const facts = book ? buildBookFacts(book, now) : buildAccountOverview(authorBooks, now);
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
    messages: [
      { role: 'system', content: DRAFT_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  });

  // Amounts the author or team already mentioned are fair to repeat.
  const conversationAmounts = [ticket.subject, ticket.description, ...messages.map((m) => m.body)].flatMap(amountsIn);
  const { text, warnings } = postProcessDraft(response.content, {
    allowedAmounts: [...facts.amounts, ...conversationAmounts, 1000],
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
