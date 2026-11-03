import { z } from 'zod';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../models/index.js';
import { paginationQuery, ticketRef } from './common.validator.js';

export const ticketParams = z.object({ ticketId: ticketRef });

export const listTicketsQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  ...paginationQuery,
});
