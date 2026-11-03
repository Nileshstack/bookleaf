import { Router } from 'express';
import * as tickets from '../controllers/ticket.controller.js';
import { authorize } from '../middleware/auth.js';
import { ticketCreationLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/index.js';
import { createTicketBody, listMyTicketsQuery, replyBody, ticketParams } from '../validators/ticket.validator.js';

// Author portal. Every handler is scoped to req.user in the service; the
// admin queue is a separate router.
const router = Router();

router.use(authorize(ROLES.AUTHOR));

// Must be registered before /:ticketId, or "stream" would be parsed as a ticket ref.
router.get('/stream', tickets.stream);

router.get('/', validate({ query: listMyTicketsQuery }), tickets.listMyTickets);
// Validation runs first, so a typo-filled form doesn't use up the author's hourly budget.
router.post('/', validate({ body: createTicketBody }), ticketCreationLimiter, tickets.createTicket);
router.get('/:ticketId', validate({ params: ticketParams }), tickets.getMyTicket);
router.post('/:ticketId/messages', validate({ params: ticketParams, body: replyBody }), tickets.replyToTicket);

export default router;
