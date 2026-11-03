import * as ticketService from '../services/ticket.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const listTickets = async (req, res) => {
  const { items, meta } = await ticketService.listTickets(req.user, req.validated.query);
  sendSuccess(res, items, { meta });
};

export const getTicket = async (req, res) => {
  sendSuccess(res, await ticketService.getTicket(req.validated.params.ticketId, req.user));
};
