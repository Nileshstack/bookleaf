import { UNRESOLVED_STATUSES } from '../models/index.js';

/**
 * Response-time targets per priority: an unresolved ticket older than this
 * is overdue. Critical and High follow the brief; Medium and Low are our
 * defaults. Unclassified tickets use the Medium target until triaged.
 */
export const RESPONSE_SLA_HOURS = Object.freeze({ Critical: 24, High: 48, Medium: 96, Low: 168 });

const HOUR_MS = 60 * 60 * 1000;

export const slaHoursFor = (priority) => RESPONSE_SLA_HOURS[priority] ?? RESPONSE_SLA_HOURS.Medium;

/** Age and SLA state for one ticket, computed against the caller's single `now`. */
export const ticketTiming = (ticket, now = new Date()) => {
  const created = new Date(ticket.createdAt).getTime();
  const slaHours = slaHoursFor(ticket.priority);
  const dueAt = created + slaHours * HOUR_MS;
  return {
    ageHours: Math.floor((now.getTime() - created) / HOUR_MS),
    slaHours,
    dueAt: new Date(dueAt),
    isOverdue: UNRESOLVED_STATUSES.includes(ticket.status) && now.getTime() > dueAt,
  };
};

/**
 * The same overdue rule as a Mongo filter, so "overdue only" and the stats
 * counter use the database instead of loading tickets to check in JS.
 */
export const overdueFilter = (now = new Date()) => ({
  isUnresolved: true,
  $or: Object.entries(RESPONSE_SLA_HOURS).map(([priority, hours]) => ({
    priority: priority === 'Medium' ? { $in: ['Medium', null] } : priority, // unclassified counts as Medium
    createdAt: { $lt: new Date(now.getTime() - hours * HOUR_MS) },
  })),
});
