import { aiClient } from '../ai/index.js';
import { usageSummary } from '../ai/usage.js';
import * as adminTickets from '../services/adminTicket.service.js';
import * as drafts from '../services/draft.service.js';
import * as triage from '../services/triage.service.js';
import * as realtime from '../services/realtime.service.js';
import * as stats from '../services/stats.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

const ticketRef = (req) => req.validated.params.ticketId;

export const listQueue = async (req, res) => {
  const { items, meta } = await adminTickets.listQueue(req.user, req.validated.query);
  sendSuccess(res, items, { meta });
};

export const getTicket = async (req, res) => {
  sendSuccess(res, await adminTickets.getTicketDetail(req.user, ticketRef(req)));
};

export const updateTicket = async (req, res) => {
  sendSuccess(res, await adminTickets.updateTicket(req.user, ticketRef(req), req.validated.body));
};

export const assignToMe = async (req, res) => {
  sendSuccess(res, await adminTickets.assignToMe(req.user, ticketRef(req)));
};

export const addNote = async (req, res) => {
  sendSuccess(res, await adminTickets.addInternalNote(req.user, ticketRef(req), req.validated.body), { statusCode: 201 });
};

export const reply = async (req, res) => {
  sendSuccess(res, await adminTickets.replyToAuthor(req.user, ticketRef(req), req.validated.body), { statusCode: 201 });
};

export const classify = async (req, res) => {
  const ticket = await triage.classifyTicket(await adminTickets.resolveTicketId(ticketRef(req)), { force: true });
  sendSuccess(res, await adminTickets.getTicketDetail(req.user, ticket._id.toString()));
};

export const draft = async (req, res) => {
  sendSuccess(res, await drafts.getDraft(req.user, ticketRef(req), req.validated.query));
};

export const aiUsage = async (req, res) => {
  sendSuccess(res, { ...(await usageSummary(req.validated.query)), client: aiClient.status() });
};

export const getStats = async (_req, res) => {
  sendSuccess(res, await stats.getStats());
};

export const stream = (req, res) => {
  realtime.openStream(req, res, req.user);
};
