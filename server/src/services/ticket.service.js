import { ROLES, Ticket, TicketMessage } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { runInBackground } from '../utils/background.js';
import { pageMeta, paginate, refFilter, scopeToOwner } from './access.js';
import { resolveOwnedBookId } from './book.service.js';
import { presentMessage, presentTicket } from './presenters.js';
import { classifyTicket } from './triage.service.js';

/**
 * Author-side ticket lifecycle. Every function takes the authenticated user
 * and scopes by ownership. Admin queue operations live in their own service.
 */

const BOOK_FIELDS = 'bookId title';
const PREVIEW_LENGTH = 140;

const preview = (text) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : text);

/** Scoped lookup shared by every single-ticket operation: missing and not-yours are both 404. */
const findOwnedTicket = async (ref, user) => {
  const ticket = await Ticket.findOne(scopeToOwner(user, refFilter(ref, 'ticketNumber')));
  if (!ticket) throw AppError.notFound('Ticket');
  return ticket;
};

export const createTicket = async (user, { bookId, subject, description, attachments }) => {
  const ticket = await Ticket.create({
    authorId: user.id,
    bookId: await resolveOwnedBookId(bookId, user),
    subject,
    description,
    attachments,
    // status, category, priority and AI fields keep their schema defaults.
    // They are never taken from the request.
  });

  // The ticket is already saved. Classification runs after the response, and
  // a slow, failing or rate-limited AI API cannot affect ticket creation.
  runInBackground('classify-ticket', () => classifyTicket(ticket._id), { ticketId: String(ticket._id) });

  await ticket.populate('bookId', BOOK_FIELDS);
  return { ...presentTicket(ticket.toObject(), user), messages: [] };
};

export const listMyTickets = async (user, { status, category, page, limit }) => {
  const filter = scopeToOwner(user, { ...(status && { status }), ...(category && { category }) });
  const { skip } = paginate({ page, limit });

  const [tickets, total] = await Promise.all([
    Ticket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('bookId', BOOK_FIELDS).lean(),
    Ticket.countDocuments(filter),
  ]);

  const latest = await TicketMessage.latestVisibleByTicket(
    tickets.map((t) => t._id),
    { viewerRole: user.role },
  );

  const items = tickets.map((t) => {
    const thread = latest.get(String(t._id));
    return {
      ...presentTicket(t, user),
      messageCount: thread?.count ?? 0,
      lastMessage: thread
        ? { senderRole: thread.last.senderRole, preview: preview(thread.last.body), createdAt: thread.last.createdAt }
        : null,
      lastActivityAt: thread?.last.createdAt ?? t.createdAt,
    };
  });

  return { items, meta: pageMeta({ page, limit }, total) };
};

export const getMyTicket = async (user, ref) => {
  const ticket = await findOwnedTicket(ref, user);
  await ticket.populate('bookId', BOOK_FIELDS);

  const messages = await TicketMessage.findThread(ticket._id, { viewerRole: user.role })
    .populate('senderId', 'name')
    .lean();

  return { ...presentTicket(ticket.toObject(), user), messages: messages.map((m) => presentMessage(m, user)) };
};

/**
 * Author follow-up. A reply to a Resolved ticket reopens it, because the
 * author is saying the issue isn't solved. A Closed ticket is final, and
 * the author is told to open a new ticket.
 */
export const addAuthorReply = async (user, ref, { body }) => {
  const ticket = await findOwnedTicket(ref, user);

  if (ticket.status === 'Closed') {
    throw new AppError('This ticket is closed and can no longer receive replies. Please open a new ticket and mention this one.', {
      statusCode: 409,
      code: 'TICKET_CLOSED',
      details: [{ field: 'ticketId', message: `${ticket.ticketNumber} is closed` }],
    });
  }

  const message = await TicketMessage.create({
    ticketId: ticket._id,
    senderRole: ROLES.AUTHOR,
    senderId: user.id,
    body,
  });

  const reopened = ticket.status === 'Resolved';
  if (reopened) ticket.status = 'Open';
  // Bump updatedAt even when status is unchanged, so "last activity" reflects the reply.
  ticket.markModified('status');
  await ticket.save();

  await message.populate('senderId', 'name');
  return {
    message: presentMessage(message.toObject(), user),
    ticket: { ticketNumber: ticket.ticketNumber, status: ticket.status, reopened },
  };
};
