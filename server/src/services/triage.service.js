import { logger } from '../utils/logger.js';

/**
 * AI triage entry point: classifies a ticket's category and priority and
 * stores the result on the ticket.
 *
 * STUB: the AI service lands in the next step. Until then tickets keep
 * aiStatus 'pending', which is the state the AI step will pick up.
 * Callers must never await this inside a request; use runInBackground.
 */
export const classifyTicket = async (ticketId) => {
  logger.info('AI classification not implemented yet; ticket left pending', { ticketId: String(ticketId) });
};
