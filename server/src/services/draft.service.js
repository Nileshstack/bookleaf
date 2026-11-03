import { createHash } from 'node:crypto';
import { aiClient, AiOutputError, AiUnavailableError } from '../ai/index.js';
import { generateDraft } from '../ai/drafter.js';
import { DEFAULT_CATEGORY, KB_VERSION } from '../ai/knowledgeBase.js';
import { DRAFT_PROMPT_VERSION } from '../ai/prompts.js';
import { fallbackTemplate } from '../ai/templates.js';
import { recordUsage } from '../ai/usage.js';
import { AiDraft, Book, ROLES, Ticket, TicketMessage, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { refFilter } from './access.js';

/**
 * AI draft replies with a per-ticket cache. A cached draft is reused while
 * its context hash still matches. The hash covers everything that would
 * change the reply:
 *  - prompt and KB versions, and the model
 *  - the ticket text and category
 *  - the referenced book's data
 *  - the newest thread message (so a new message forces a fresh draft)
 *  - today's date, because drafts quote "next payout" dates
 * Anything else regenerates only when the admin asks (regenerate=true).
 */

const contextHashOf = ({ ticket, category, book, messages, model, day }) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        v: [DRAFT_PROMPT_VERSION, KB_VERSION, model],
        day,
        ticket: [ticket.subject, ticket.description, category],
        book: book ? [String(book._id), book.updatedAt?.toISOString?.() ?? null] : null,
        thread: [messages.length, String(messages.at(-1)?._id ?? '')],
      }),
    )
    .digest('hex');

const presentDraft = (draft, { cached }) => ({
  draftText: draft.draftText,
  generatedAt: draft.generatedAt,
  model: draft.model,
  cached,
  warnings: draft.warnings ?? [],
  context: draft.context,
  tokenUsage: draft.tokenUsage,
});

export const getDraft = async (_admin, ref, { regenerate = false, client = aiClient } = {}) => {
  const ticket = await Ticket.findOne(refFilter(ref, 'ticketNumber')).lean();
  if (!ticket) throw AppError.notFound('Ticket');

  const [author, book, messages, cached] = await Promise.all([
    User.findById(ticket.authorId).lean(),
    ticket.bookId ? Book.findById(ticket.bookId).lean() : null,
    TicketMessage.findThread(ticket._id, { viewerRole: ROLES.ADMIN }).lean(),
    AiDraft.findOne({ ticketId: ticket._id }).lean(),
  ]);
  // General tickets have no referenced book; the drafter gets a one-line-per-book overview instead.
  const authorBooks = book ? [] : await Book.find({ authorId: ticket.authorId }).lean();

  const category = ticket.category ?? ticket.aiCategory ?? DEFAULT_CATEGORY;
  const now = new Date();
  const contextHash = contextHashOf({ ticket, category, book, messages, model: client.model, day: now.toISOString().slice(0, 10) });

  if (!regenerate && cached?.contextHash === contextHash) {
    recordUsage({ feature: 'draft', outcome: 'cache_hit', model: cached.model, ticketId: ticket._id });
    return presentDraft(cached, { cached: true });
  }

  let result;
  try {
    result = await generateDraft({ ticket: { ...ticket, category }, book, author, authorBooks, messages, now }, { client });
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiOutputError)) throw err;
    // The admin can always keep working: a policy-safe template plus the
    // last good draft, if any, clearly marked as possibly outdated.
    throw new AppError('AI drafting is unavailable right now. Use the template below or write the reply manually.', {
      statusCode: 503,
      code: 'AI_UNAVAILABLE',
      extra: {
        reason: err.code,
        fallback: {
          template: fallbackTemplate({ category, authorName: author?.name, ticketNumber: ticket.ticketNumber }),
          staleDraft: cached ? { draftText: cached.draftText, generatedAt: cached.generatedAt } : null,
        },
      },
    });
  }

  const saved = await AiDraft.findOneAndUpdate(
    { ticketId: ticket._id },
    {
      $set: {
        draftText: result.text,
        generatedAt: now,
        model: result.model,
        contextHash,
        tokenUsage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        },
        warnings: result.warnings,
        context: { category: result.context.category, sections: result.context.sections, exampleId: result.context.exampleId },
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();

  return presentDraft(saved, { cached: false });
};
