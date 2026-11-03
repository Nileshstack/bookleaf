import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/index.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import {
  adminReplyBody,
  adminTicketListQuery,
  aiUsageQuery,
  draftQuery,
  internalNoteBody,
  updateTicketBody,
} from '../validators/admin.validator.js';
import { ticketParams } from '../validators/ticket.validator.js';

// Admin portal. Mounted at /admin; every route requires the admin role.
const router = Router();

router.use(authorize(ROLES.ADMIN));

router.get('/stats', admin.getStats);

// Must be registered before /tickets/:ticketId, or "stream" would be parsed as a ticket ref.
router.get('/tickets/stream', admin.stream);

router.get('/tickets', validate({ query: adminTicketListQuery }), admin.listQueue);
router.get('/tickets/:ticketId', validate({ params: ticketParams }), admin.getTicket);
router.patch('/tickets/:ticketId', validate({ params: ticketParams, body: updateTicketBody }), admin.updateTicket);
router.post('/tickets/:ticketId/assign-to-me', validate({ params: ticketParams }), admin.assignToMe);
router.post('/tickets/:ticketId/notes', validate({ params: ticketParams, body: internalNoteBody }), admin.addNote);
router.post('/tickets/:ticketId/reply', validate({ params: ticketParams, body: adminReplyBody }), admin.reply);

// AI endpoints cost money per call, so they get the stricter aiLimiter.
router.post('/tickets/:ticketId/draft', aiLimiter, validate({ params: ticketParams, query: draftQuery }), admin.draft);
router.post('/tickets/:ticketId/classify', aiLimiter, validate({ params: ticketParams }), admin.classify);
router.get('/ai/usage', validate({ query: aiUsageQuery }), admin.aiUsage);

export default router;
