import * as ticketService from '../services/ticket.service.js';
import * as realtime from '../services/realtime.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const createTicket = async (req, res) => {
  const ticket = await ticketService.createTicket(req.user, req.validated.body);
  res.location(`/api/v1/tickets/${ticket.ticketNumber}`);
  sendSuccess(res, ticket, { statusCode: 201 });
};

export const listMyTickets = async (req, res) => {
  const { items, meta } = await ticketService.listMyTickets(req.user, req.validated.query);
  sendSuccess(res, items, { meta });
};

export const getMyTicket = async (req, res) => {
  sendSuccess(res, await ticketService.getMyTicket(req.user, req.validated.params.ticketId));
};

export const replyToTicket = async (req, res) => {
  const result = await ticketService.addAuthorReply(req.user, req.validated.params.ticketId, req.validated.body);
  sendSuccess(res, result, { statusCode: 201 });
};

export const stream = (req, res) => {
  realtime.openStream(req, res, req.user);
};
