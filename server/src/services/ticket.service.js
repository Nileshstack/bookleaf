import { Ticket, TicketMessage } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isAdmin, pageMeta, paginate, refFilter, scopeToOwner } from './access.js';
import { presentMessage, presentTicket } from './presenters.js';

const BOOK_FIELDS = 'bookId title';
const PERSON_FIELDS = 'name email authorCode';

export const listTickets = async (user, { status, category, priority, page, limit }) => {
  const filter = { ...(status && { status }), ...(category && { category }) };
  // Priority is internal triage data, so authors can't filter on it either.
  if (priority && isAdmin(user)) filter.priority = priority;

  const scoped = scopeToOwner(user, filter);
  // Admins work the queue most-urgent-then-oldest; authors see their latest first.
  const sort = isAdmin(user) ? { priorityRank: 1, createdAt: 1 } : { createdAt: -1 };
  const { skip } = paginate({ page, limit });

  let query = Ticket.find(scoped).sort(sort).skip(skip).limit(limit).populate('bookId', BOOK_FIELDS);
  if (isAdmin(user)) query = query.populate('authorId', PERSON_FIELDS).populate('assignedTo', PERSON_FIELDS);

  const [tickets, total] = await Promise.all([query.lean(), Ticket.countDocuments(scoped)]);

  return { items: tickets.map((t) => presentTicket(t, user)), meta: pageMeta({ page, limit }, total) };
};

export const getTicket = async (ref, user) => {
  const ticket = await Ticket.findOne(scopeToOwner(user, refFilter(ref, 'ticketNumber')))
    .populate('bookId', BOOK_FIELDS)
    .populate('authorId', PERSON_FIELDS)
    .populate('assignedTo', PERSON_FIELDS)
    .lean();
  if (!ticket) throw AppError.notFound('Ticket');

  const messages = await TicketMessage.findThread(ticket._id, { viewerRole: user.role })
    .populate('senderId', 'name')
    .lean();

  return { ...presentTicket(ticket, user), messages: messages.map((m) => presentMessage(m, user)) };
};
