import { z } from 'zod';
import { AI_STATUSES, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../models/index.js';
import { isObjectId } from '../utils/ids.js';
import { objectId, paginationQuery } from './common.validator.js';

/**
 * Multi-value filter: ?status=Open,In%20Progress or repeated ?status=Open&status=Resolved.
 * Every value must be in the allowed list.
 */
const multi = (values) =>
  z
    .preprocess(
      (v) =>
        v === undefined ? v : [v].flat().flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean),
      z.array(z.enum(values)).min(1),
    )
    .optional();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts YYYY-MM-DD (UTC day) or a full ISO timestamp. A date-only `to`
 * means the end of that day, so from=2025-01-15&to=2025-01-15 covers the
 * whole day. Send full timestamps with an offset for exact local-day bounds.
 */
const dateParam = (edge) =>
  z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Must be a date (YYYY-MM-DD) or ISO timestamp' })
    .transform((v) => (edge === 'end' && DATE_ONLY.test(v) ? new Date(`${v}T23:59:59.999Z`) : new Date(v)))
    .optional();

export const adminTicketListQuery = z
  .object({
    status: multi(TICKET_STATUSES),
    category: multi(TICKET_CATEGORIES),
    priority: multi(TICKET_PRIORITIES),
    aiStatus: multi(AI_STATUSES),
    authorId: z
      .string()
      .trim()
      .refine((v) => isObjectId(v) || /^AUTH\d{3,}$/i.test(v), { message: 'Must be an id or an author code like AUTH001' })
      .transform((v) => (isObjectId(v) ? v : v.toUpperCase()))
      .optional(),
    assignedTo: z
      .string()
      .trim()
      .refine((v) => v === 'me' || v === 'unassigned' || isObjectId(v), {
        message: 'Must be "me", "unassigned" or an admin id',
      })
      .optional(),
    from: dateParam('start'),
    to: dateParam('end'),
    q: z.string().trim().min(1).max(100).optional(),
    overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    sort: z.enum(['queue', 'newest', 'oldest', 'updated']).default('queue'),
    ...paginationQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"to" must not be before "from"', path: ['to'] });

/**
 * Strict: an unknown key such as aiCategory is rejected rather than silently
 * ignored, so a client can't believe it changed a field that it didn't.
 */
export const updateTicketBody = z
  .strictObject({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assignedTo: objectId.nullable().optional(), // null unassigns
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one of: status, category, priority, assignedTo',
  });

const messageText = z
  .string({ error: 'Message is required' })
  .trim()
  .min(1, 'Message cannot be empty')
  .max(5000, 'Message must be at most 5000 characters');

export const internalNoteBody = z.strictObject({ body: messageText });

export const adminReplyBody = z.strictObject({
  body: messageText,
  // True when the admin started from the AI draft, whether sent as-is or edited.
  wasAiDrafted: z.boolean().default(false),
  // Optional status change in the same action, e.g. reply and mark Resolved.
  status: z.enum(TICKET_STATUSES).optional(),
});
