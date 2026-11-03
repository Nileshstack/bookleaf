import { aiClient, AiOutputError, AiUnavailableError } from '../ai/index.js';
import { classifyWithAi } from '../ai/classifier.js';
import { classifyWithRules } from '../ai/fallbackClassifier.js';
import { Book, ROLES, Ticket, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { isPublished, monthsBetween } from './bookInsights.js';
import { publishToRole, publishToUser } from './realtime.service.js';

/**
 * Ticket triage: AI first, keyword rules if the AI is unavailable or returns
 * invalid output. A ticket therefore always ends up with a category and
 * priority. Callers run this in the background (ticket creation) or on
 * demand (admin "re-run AI").
 */

/** Small, numeric account signal for the classifier. A few dozen tokens, not the author's whole record. */
const buildAccountContext = async (ticket, now) => {
  const [author, book, [totals]] = await Promise.all([
    User.findById(ticket.authorId).select('joinedDate').lean(),
    ticket.bookId ? Book.findById(ticket.bookId).lean() : null,
    Book.aggregate([
      { $match: { authorId: ticket.authorId } },
      {
        $group: {
          _id: null,
          pending: { $sum: '$royaltyPending' },
          inProduction: { $sum: { $cond: [{ $ne: ['$status', 'Published & Live'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const bookContext = !book
    ? 'none (general / account-level query)'
    : isPublished(book)
      ? {
          status: 'published',
          months_since_publication: monthsBetween(book.publicationDate, now),
          royalty_paid_inr: book.royaltyPaid,
          royalty_pending_inr: book.royaltyPending,
          months_since_last_payout: book.lastRoyaltyPayoutDate ? monthsBetween(book.lastRoyaltyPayoutDate, now) : 'never paid',
        }
      : { status: `in production (${book.status})` };

  return {
    forModel: {
      author_tenure_months: monthsBetween(author?.joinedDate, now),
      book: bookContext,
      account_royalty_pending_inr: totals?.pending ?? 0,
      books_in_production: totals?.inProduction ?? 0,
    },
    forRules: {
      monthsSinceLastPayout: book?.lastRoyaltyPayoutDate ? monthsBetween(book.lastRoyaltyPayoutDate, now) : null,
      monthsSincePublication: book?.publicationDate ? monthsBetween(book.publicationDate, now) : null,
    },
  };
};

/** Applies a result without overwriting an admin's explicit choice. */
const applyResult = (ticket, result) => {
  if (ticket.categoryOverridden) ticket.categoryOverridden = ticket.category !== ticket.aiCategory;
  else ticket.category = result.category;

  if (ticket.priorityOverridden) ticket.priorityOverridden = ticket.priority !== ticket.aiPriority;
  else ticket.priority = result.priority;
};

// Longer than the worst case for one AI call: 3 attempts × 15s timeout, plus backoff.
const CLAIM_LEASE_MS = 2 * 60 * 1000;

/**
 * Atomically takes the classification lease. Exactly one caller wins; the
 * others get null and skip. An expired lease (a process that died
 * mid-classification) can be taken over.
 */
const claim = (ticketId, { force }) =>
  Ticket.findOneAndUpdate(
    {
      _id: ticketId,
      ...(!force && { aiStatus: { $ne: 'done' } }),
      $or: [{ aiClaimedAt: null }, { aiClaimedAt: { $lt: new Date(Date.now() - CLAIM_LEASE_MS) } }],
    },
    { $set: { aiClaimedAt: new Date() } },
    { returnDocument: 'after', timestamps: false },
  );

const release = (ticketId) => Ticket.updateOne({ _id: ticketId }, { $set: { aiClaimedAt: null } }, { timestamps: false });

/**
 * @param ticketId
 * @param options.force re-run even if the AI already classified this ticket (admin "re-run AI")
 * @returns the updated ticket, or null if it doesn't exist, is already
 *   classified, or another process holds the lease
 * @throws AppError 409 when forced while another classification is in flight
 */
export const classifyTicket = async (ticketId, { force = false, client = aiClient } = {}) => {
  const ticket = await claim(ticketId, { force });
  if (!ticket) {
    if (force && (await Ticket.exists({ _id: ticketId }))) {
      throw AppError.conflict('This ticket is already being classified. Try again in a moment.');
    }
    return null; // background path: someone else has it, or it's already done
  }

  try {
    return await classifyClaimed(ticket, client);
  } finally {
    // Normally the save below has already cleared the lease; this covers unexpected errors.
    if (ticket.aiClaimedAt) await release(ticket._id).catch(() => {});
  }
};

const classifyClaimed = async (ticket, client) => {
  const now = new Date();
  const context = await buildAccountContext(ticket, now);
  const authorVisibleBefore = ticket.category;

  try {
    const ai = await classifyWithAi(ticket, context.forModel, { client });
    ticket.aiCategory = ai.category;
    ticket.aiPriority = ai.priority;
    ticket.aiReasoning = ai.reasoning;
    ticket.aiConfidence = ai.confidence;
    ticket.aiStatus = 'done';
    ticket.aiError = null;
    ticket.classificationSource = 'ai';
    applyResult(ticket, ai);
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiOutputError)) throw err;

    const rules = classifyWithRules(ticket, context.forRules);
    // aiCategory/aiPriority are left untouched: a keyword guess is not an AI
    // suggestion, and keeping them separate keeps the accuracy stats honest.
    ticket.aiReasoning = rules.reasoning;
    ticket.aiConfidence = rules.confidence;
    ticket.aiStatus = 'failed';
    ticket.aiError = `${err.code}: ${err.message}`.slice(0, 500);
    ticket.classificationSource = 'rules';
    applyResult(ticket, rules);
    logger.warn('AI classification failed; used rule-based fallback', {
      ticketId: String(ticket._id),
      code: err.code,
      category: rules.category,
      priority: rules.priority,
    });
  }

  ticket.aiClaimedAt = null;
  await ticket.save();

  publishToRole(ROLES.ADMIN, 'ticket.classified', {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    category: ticket.category,
    priority: ticket.priority,
    aiStatus: ticket.aiStatus,
    classificationSource: ticket.classificationSource,
    aiReasoning: ticket.aiReasoning,
  });
  if (ticket.category !== authorVisibleBefore) {
    publishToUser(ticket.authorId, 'ticket.updated', {
      ticketId: ticket._id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      category: ticket.category,
      updatedAt: ticket.updatedAt,
    });
  }

  return ticket;
};

/**
 * Picks up tickets still 'pending', for example after a restart killed
 * in-flight background work. Once an API key is configured, it also picks up
 * tickets that only got the rule fallback because AI was switched off. Runs
 * sequentially to stay gentle on rate limits.
 */
export const recoverPendingClassifications = async ({ olderThanMs = 60_000, limit = 25, client = aiClient } = {}) => {
  const candidates = [{ aiStatus: 'pending' }];
  if (client.enabled) candidates.push({ aiStatus: 'failed', aiError: /^AI_DISABLED/ });

  const pending = await Ticket.find({ $or: candidates, createdAt: { $lt: new Date(Date.now() - olderThanMs) } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('_id')
    .lean();

  for (const { _id } of pending) {
    try {
      await classifyTicket(_id);
    } catch (err) {
      logger.error('Recovery classification failed', { ticketId: String(_id), error: err.message });
    }
  }
  return pending.length;
};
