import { z } from 'zod';
import { ATTACHMENT_LIMITS, TICKET_CATEGORIES, TICKET_STATUSES } from '../models/index.js';
import { bookRef, paginationQuery, ticketRef } from './common.validator.js';

export const ticketParams = z.object({ ticketId: ticketRef });

/** Author's ticket list. Priority is internal triage data, so it isn't filterable here. */
export const listMyTicketsQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  ...paginationQuery,
});

const attachment = z.object({
  fileName: z.string({ error: 'fileName is required' }).trim().min(1).max(255),
  sizeBytes: z
    .number({ error: 'sizeBytes must be a number' })
    .int()
    .positive()
    .max(ATTACHMENT_LIMITS.maxSizeBytes, 'Each attachment must be 10 MB or smaller'),
  mimeType: z.enum(ATTACHMENT_LIMITS.mimeTypes, {
    error: 'Unsupported file type (allowed: images, PDF, Word, plain text)',
  }),
});

/**
 * Only these fields are accepted. Zod strips unknown keys, so an author
 * sending status, priority, category or authorId has no effect (no mass
 * assignment).
 */
export const createTicketBody = z.object({
  // Missing, null or "" all mean "General / Account Level".
  bookId: z.preprocess((v) => (v === '' ? null : v), bookRef.nullish()),
  subject: z
    .string({ error: 'Subject is required' })
    .trim()
    .min(5, 'Subject must be at least 5 characters')
    .max(200, 'Subject must be at most 200 characters'),
  description: z
    .string({ error: 'Description is required' })
    .trim()
    .min(20, 'Please describe the issue in at least 20 characters so we can help faster')
    .max(5000, 'Description must be at most 5000 characters'),
  attachments: z
    .array(attachment)
    .max(ATTACHMENT_LIMITS.maxFiles, `At most ${ATTACHMENT_LIMITS.maxFiles} attachments`)
    .default([]),
});

export const replyBody = z.object({
  body: z
    .string({ error: 'Message is required' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(5000, 'Message must be at most 5000 characters'),
});
