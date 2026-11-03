import { Router } from 'express';
import * as tickets from '../controllers/ticket.controller.js';
import { validate } from '../middleware/validate.js';
import { listTicketsQuery, ticketParams } from '../validators/ticket.validator.js';

// Shared by both portals: authors are scoped to their own tickets in the
// service, and responses are shaped per role.
const router = Router();

router.get('/', validate({ query: listTicketsQuery }), tickets.listTickets);
router.get('/:ticketId', validate({ params: ticketParams }), tickets.getTicket);

export default router;
