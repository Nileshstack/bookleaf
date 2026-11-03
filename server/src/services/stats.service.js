import { Ticket, TicketMessage, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../models/index.js';
import { overdueFilter } from './ticketInsights.js';

const HOUR_MS = 60 * 60 * 1000;
const UNCLASSIFIED = 'Unclassified';

const countSum = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });

/** Fills every known key with 0 so the dashboard never has gaps; null becomes "Unclassified". */
const toCounts = (rows, keys) => {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const { _id, count } of rows) counts[_id ?? UNCLASSIFIED] = count;
  return counts;
};

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

/**
 * Dashboard numbers in one aggregation.
 *
 * AI override rate = of the tickets where the AI made a suggestion, the
 * share where the admin's final value differs. Tickets the AI never
 * classified are excluded, so a manual triage after an AI outage isn't
 * counted as the AI being wrong.
 */
export const getStats = async () => {
  const now = new Date();

  const [facets] = await Ticket.aggregate([
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
        byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
        unresolved: [
          { $match: { isUnresolved: true } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              averageAgeMs: { $avg: { $subtract: [now, '$createdAt'] } },
              unassigned: countSum({ $eq: [{ $ifNull: ['$assignedTo', null] }, null] }),
            },
          },
        ],
        overdue: [{ $match: overdueFilter(now) }, { $count: 'count' }],
        ai: [
          {
            $group: {
              _id: null,
              pending: countSum({ $eq: ['$aiStatus', 'pending'] }),
              failed: countSum({ $eq: ['$aiStatus', 'failed'] }),
              done: countSum({ $eq: ['$aiStatus', 'done'] }),
              categorySuggested: countSum({ $ne: [{ $ifNull: ['$aiCategory', null] }, null] }),
              categoryOverridden: countSum({
                $and: [{ $ne: [{ $ifNull: ['$aiCategory', null] }, null] }, '$categoryOverridden'],
              }),
              prioritySuggested: countSum({ $ne: [{ $ifNull: ['$aiPriority', null] }, null] }),
              priorityOverridden: countSum({
                $and: [{ $ne: [{ $ifNull: ['$aiPriority', null] }, null] }, '$priorityOverridden'],
              }),
            },
          },
        ],
      },
    },
  ]);

  // How often agents start from the AI draft: a direct measure of whether drafting earns its cost.
  const [replies] = await TicketMessage.aggregate([
    { $match: { senderRole: 'admin', isInternalNote: false } },
    { $group: { _id: null, sent: { $sum: 1 }, aiDrafted: countSum('$wasAiDrafted') } },
  ]);

  const byStatus = toCounts(facets.byStatus, TICKET_STATUSES);
  const unresolved = facets.unresolved[0];
  const ai = facets.ai[0] ?? {};

  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    byCategory: toCounts(facets.byCategory, [...TICKET_CATEGORIES, UNCLASSIFIED]),
    byPriority: toCounts(facets.byPriority, [...TICKET_PRIORITIES, UNCLASSIFIED]),
    unresolved: {
      count: unresolved?.count ?? 0,
      averageAgeHours: unresolved ? Math.round((unresolved.averageAgeMs / HOUR_MS) * 10) / 10 : null,
      overdue: facets.overdue[0]?.count ?? 0,
      unassigned: unresolved?.unassigned ?? 0,
    },
    ai: {
      classification: { pending: ai.pending ?? 0, failed: ai.failed ?? 0, done: ai.done ?? 0 },
      category: {
        suggested: ai.categorySuggested ?? 0,
        overridden: ai.categoryOverridden ?? 0,
        overrideRate: rate(ai.categoryOverridden ?? 0, ai.categorySuggested ?? 0),
      },
      priority: {
        suggested: ai.prioritySuggested ?? 0,
        overridden: ai.priorityOverridden ?? 0,
        overrideRate: rate(ai.priorityOverridden ?? 0, ai.prioritySuggested ?? 0),
      },
      drafts: {
        repliesSent: replies?.sent ?? 0,
        aiDrafted: replies?.aiDrafted ?? 0,
        adoptionRate: rate(replies?.aiDrafted ?? 0, replies?.sent ?? 0),
      },
    },
    generatedAt: now.toISOString(),
  };
};
