import mongoose from 'mongoose';
import { Book, ROLES, Ticket, TicketMessage, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isObjectId } from '../utils/ids.js';
import { pageMeta, paginate, refFilter } from './access.js';
import { presentBook } from './book.service.js';
import { PUBLISHED_STATUS } from './bookInsights.js';
import { presentMessage, presentTicket } from './presenters.js';
import { publishToRole, publishToUser } from './realtime.service.js';
import { overdueFilter, ticketTiming } from './ticketInsights.js';

/**
 * Admin queue and ticket management. Admins see every ticket, so there's no
 * ownership scoping here; the admin router's role gate guards access.
 */

const BOOK_FIELDS = 'bookId title';
const PERSON_FIELDS = 'name email authorCode';
const PREVIEW_LENGTH = 140;

const SORTS = {
  // Unresolved first, then most urgent (Critical = rank 0), then oldest.
  // _id breaks ties so pagination is stable.
  queue: { isUnresolved: -1, priorityRank: 1, createdAt: 1, _id: 1 },
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  updated: { updatedAt: -1, _id: -1 },
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const preview = (text) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : text);

const authorRefToId = async (ref) => {
  if (isObjectId(ref)) return ref;
  const author = await User.findOne({ authorCode: ref }).select('_id').lean();
  return author?._id ?? null; // an unknown code matches nothing; it is a filter, not a lookup
};

/** Text search over subject, description and ticket number, plus author name/email and book title. */
const searchCondition = async (q) => {
  const pattern = new RegExp(escapeRegex(q), 'i');
  const [authors, books] = await Promise.all([
    User.find({ role: ROLES.AUTHOR, $or: [{ name: pattern }, { email: pattern }] }).select('_id').lean(),
    Book.find({ title: pattern }).select('_id').lean(),
  ]);
  return {
    $or: [
      { subject: pattern },
      { description: pattern },
      { ticketNumber: pattern },
      { authorId: { $in: authors.map((a) => a._id) } },
      { bookId: { $in: books.map((b) => b._id) } },
    ],
  };
};

const buildQueueFilter = async (admin, query, now) => {
  const conditions = [];
  const inList = (field, values) => values && conditions.push({ [field]: { $in: values } });

  inList('status', query.status);
  inList('category', query.category);
  inList('priority', query.priority);
  inList('aiStatus', query.aiStatus);

  if (query.authorId) conditions.push({ authorId: await authorRefToId(query.authorId) });

  if (query.assignedTo === 'me') conditions.push({ assignedTo: admin.id });
  else if (query.assignedTo === 'unassigned') conditions.push({ assignedTo: null });
  else if (query.assignedTo) conditions.push({ assignedTo: query.assignedTo });

  if (query.from || query.to) {
    conditions.push({ createdAt: { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) } });
  }

  if (query.overdue === true) conditions.push(overdueFilter(now));
  if (query.overdue === false) conditions.push({ $nor: [overdueFilter(now)] });

  if (query.q) conditions.push(await searchCondition(query.q));

  return conditions.length ? { $and: conditions } : {};
};

const withTiming = (ticket, now) => {
  const { ageHours, slaHours, dueAt, isOverdue } = ticketTiming(ticket, now);
  return { ageHours, slaHours, dueAt, isOverdue };
};

export const listQueue = async (admin, query) => {
  const now = new Date();
  const filter = await buildQueueFilter(admin, query, now);
  const { skip, limit } = paginate(query);

  const [tickets, total] = await Promise.all([
    Ticket.find(filter)
      .sort(SORTS[query.sort])
      .skip(skip)
      .limit(limit)
      .populate('bookId', BOOK_FIELDS)
      .populate('authorId', PERSON_FIELDS)
      .populate('assignedTo', PERSON_FIELDS)
      .lean(),
    Ticket.countDocuments(filter),
  ]);

  const ids = tickets.map((t) => t._id);
  // Two previews: the latest entry the team sees (notes included), and the latest the author
  // sees. The second tells us whose turn it is.
  const [latestForTeam, latestPublic] = await Promise.all([
    TicketMessage.latestVisibleByTicket(ids, { viewerRole: ROLES.ADMIN }),
    TicketMessage.latestVisibleByTicket(ids, { viewerRole: ROLES.AUTHOR }),
  ]);

  const items = tickets.map((t) => {
    const team = latestForTeam.get(String(t._id));
    const lastPublic = latestPublic.get(String(t._id))?.last;
    return {
      ...presentTicket(t, admin),
      ...withTiming(t, now),
      messageCount: team?.count ?? 0,
      lastMessage: team
        ? {
            senderRole: team.last.senderRole,
            isInternalNote: team.last.isInternalNote,
            preview: preview(team.last.body),
            createdAt: team.last.createdAt,
          }
        : null,
      // Nobody on the team has answered yet, or the author spoke last.
      awaitingTeamResponse: t.isUnresolved && (!lastPublic || lastPublic.senderRole === ROLES.AUTHOR),
    };
  });

  return { items, meta: pageMeta(query, total) };
};

const findTicketDoc = async (ref) => {
  const ticket = await Ticket.findOne(refFilter(ref, 'ticketNumber'));
  if (!ticket) throw AppError.notFound('Ticket');
  return ticket;
};

const authorSummary = async (authorId) => {
  const [author, [books], [tickets]] = await Promise.all([
    User.findById(authorId).lean(),
    Book.aggregate([
      { $match: { authorId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          published: { $sum: { $cond: [{ $eq: ['$status', PUBLISHED_STATUS] }, 1, 0] } },
          totalRoyaltyEarned: { $sum: '$totalRoyaltyEarned' },
          royaltyPaid: { $sum: '$royaltyPaid' },
          royaltyPending: { $sum: '$royaltyPending' },
        },
      },
    ]),
    Ticket.aggregate([
      { $match: { authorId } },
      { $group: { _id: null, total: { $sum: 1 }, unresolved: { $sum: { $cond: ['$isUnresolved', 1, 0] } } } },
    ]),
  ]);
  if (!author) return null;

  return {
    _id: author._id,
    name: author.name,
    email: author.email,
    phone: author.phone,
    city: author.city,
    authorCode: author.authorCode,
    joinedDate: author.joinedDate,
    books: {
      total: books?.total ?? 0,
      published: books?.published ?? 0,
      totalRoyaltyEarned: books?.totalRoyaltyEarned ?? 0,
      royaltyPaid: books?.royaltyPaid ?? 0,
      royaltyPending: books?.royaltyPending ?? 0,
    },
    tickets: { total: tickets?.total ?? 0, unresolved: tickets?.unresolved ?? 0 },
  };
};

export const getTicketDetail = async (admin, ref) => {
  const now = new Date();
  const ticket = await Ticket.findOne(refFilter(ref, 'ticketNumber'))
    .populate('authorId', PERSON_FIELDS)
    .populate('assignedTo', PERSON_FIELDS)
    .lean();
  if (!ticket) throw AppError.notFound('Ticket');

  const authorId = ticket.authorId?._id ?? ticket.authorId;
  const otherOpenFilter = { authorId, _id: { $ne: ticket._id }, isUnresolved: true };

  const [messages, author, book, otherOpenCount, otherOpen] = await Promise.all([
    TicketMessage.findThread(ticket._id, { viewerRole: ROLES.ADMIN }).populate('senderId', 'name').lean(),
    authorSummary(new mongoose.Types.ObjectId(String(authorId))),
    ticket.bookId ? Book.findById(ticket.bookId) : null,
    Ticket.countDocuments(otherOpenFilter),
    Ticket.find(otherOpenFilter)
      .sort(SORTS.queue)
      .limit(5)
      .select('ticketNumber subject status priority createdAt')
      .lean(),
  ]);

  return {
    ...presentTicket({ ...ticket, bookId: book }, admin),
    ...withTiming(ticket, now),
    messages: messages.map((m) => presentMessage(m, admin)),
    authorProfile: author,
    book: book ? presentBook(book, now) : null,
    otherOpenTickets: { count: otherOpenCount, items: otherOpen },
  };
};

const resolveAssignee = async (userId) => {
  const assignee = await User.findOne({ _id: userId, role: ROLES.ADMIN }).select('_id').lean();
  if (!assignee) {
    throw AppError.validation([{ field: 'assignedTo', message: 'Tickets can only be assigned to an admin user' }]);
  }
  return assignee._id;
};

/** What the author's live view needs: never priority, AI fields or notes. */
const notifyAuthorOfUpdate = (ticket) =>
  publishToUser(ticket.authorId, 'ticket.updated', {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    category: ticket.category,
    updatedAt: ticket.updatedAt,
  });

const notifyAdmins = (event, ticket, extra = {}) =>
  publishToRole(ROLES.ADMIN, event, {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    assignedTo: ticket.assignedTo,
    updatedAt: ticket.updatedAt,
    ...extra,
  });

/**
 * Admin edits. A category or priority set by an admin is recorded as
 * overridden whenever it differs from the AI's suggestion. If the AI never
 * gave one, the value is still marked as a human decision, so a late AI
 * result can't overwrite it. The AI's original values are never changed
 * here, which keeps them available for accuracy analysis.
 */
export const updateTicket = async (admin, ref, changes) => {
  const ticket = await findTicketDoc(ref);
  const authorVisibleBefore = `${ticket.status}|${ticket.category}`;

  if (changes.category !== undefined) {
    ticket.category = changes.category;
    ticket.categoryOverridden = changes.category !== ticket.aiCategory;
  }
  if (changes.priority !== undefined) {
    ticket.priority = changes.priority;
    ticket.priorityOverridden = changes.priority !== ticket.aiPriority;
  }
  if (changes.status !== undefined) ticket.status = changes.status;
  if (changes.assignedTo !== undefined) {
    ticket.assignedTo = changes.assignedTo === null ? null : await resolveAssignee(changes.assignedTo);
  }

  await ticket.save();

  if (`${ticket.status}|${ticket.category}` !== authorVisibleBefore) notifyAuthorOfUpdate(ticket);
  notifyAdmins('ticket.updated', ticket, { updatedBy: admin.name });

  return getTicketDetail(admin, ticket._id.toString());
};

export const assignToMe = async (admin, ref) => {
  const ticket = await findTicketDoc(ref);
  const previousAssignee = ticket.assignedTo;
  ticket.assignedTo = admin.id;
  await ticket.save();

  notifyAdmins('ticket.updated', ticket, { updatedBy: admin.name });
  const detail = await getTicketDetail(admin, ticket._id.toString());
  return { ...detail, previousAssigneeId: previousAssignee };
};

export const addInternalNote = async (admin, ref, { body }) => {
  const ticket = await findTicketDoc(ref);
  const note = await TicketMessage.create({
    ticketId: ticket._id,
    senderRole: ROLES.ADMIN,
    senderId: admin.id,
    body,
    isInternalNote: true,
  });
  // Deliberately not touching ticket.updatedAt and not notifying the author:
  // a note is invisible to them in every respect.
  notifyAdmins('ticket.note', ticket, { by: admin.name });

  await note.populate('senderId', 'name');
  return presentMessage(note.toObject(), admin);
};

/**
 * Sends a response the author will see. Defaults that save the agent a click:
 *  - with no explicit status, an Open ticket moves to In Progress (someone is on it)
 *  - an unassigned ticket is assigned to the replying admin
 * A Closed ticket must be reopened explicitly (status in the same call).
 */
export const replyToAuthor = async (admin, ref, { body, wasAiDrafted, status }) => {
  const ticket = await findTicketDoc(ref);

  if (ticket.status === 'Closed' && status === undefined) {
    throw new AppError('This ticket is closed. Include a status (for example "In Progress") to reopen it and reply.', {
      statusCode: 409,
      code: 'TICKET_CLOSED',
      details: [{ field: 'status', message: `${ticket.ticketNumber} is closed` }],
    });
  }

  const message = await TicketMessage.create({
    ticketId: ticket._id,
    senderRole: ROLES.ADMIN,
    senderId: admin.id,
    body,
    wasAiDrafted,
  });

  ticket.status = status ?? (ticket.status === 'Open' ? 'In Progress' : ticket.status);
  if (!ticket.assignedTo) ticket.assignedTo = admin.id;
  ticket.markModified('status'); // bump updatedAt even if the status is unchanged
  await ticket.save();

  await message.populate('senderId', 'name');
  const forAuthor = presentMessage(message.toObject(), { role: ROLES.AUTHOR });

  publishToUser(ticket.authorId, 'ticket.message', {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    message: forAuthor,
  });
  notifyAdmins('ticket.updated', ticket, { updatedBy: admin.name });

  return {
    message: presentMessage(message.toObject(), admin),
    ticket: { ticketNumber: ticket.ticketNumber, status: ticket.status, assignedTo: ticket.assignedTo },
  };
};
