import { ROLES } from '../models/index.js';
import { ADMINS_CHANNEL, publish, userChannel } from './eventHub.js';
import { presentMessage } from './presenters.js';

/**
 * Domain events, and the only place that decides what each audience sees.
 *
 * Author events (channel user:<authorId>):
 *   admin_reply     { ticket, message }  message shaped by the author presenter
 *   status_changed  { ticket, previousStatus }
 * Admin events (channel admins):
 *   new_ticket, ticket_classified, author_reply, ticket_updated
 *
 * Author payloads are built from an explicit whitelist (authorTicket), never
 * by passing a ticket document through. Priority, AI fields, assignee and
 * internal notes therefore can't leak by accident. Internal notes are also
 * refused outright before anything is published on an author channel.
 */

const id = (v) => (v ? String(v._id ?? v) : null);
const PREVIEW_LENGTH = 140;
const preview = (text = '') => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : text);

const authorTicket = (t) => ({
  ticketId: id(t._id),
  ticketNumber: t.ticketNumber,
  status: t.status,
  updatedAt: t.updatedAt,
});

const adminTicket = (t) => ({
  ...authorTicket(t),
  subject: t.subject,
  category: t.category,
  priority: t.priority,
  aiStatus: t.aiStatus,
  classificationSource: t.classificationSource ?? null,
  assignedTo: id(t.assignedTo),
  authorId: id(t.authorId),
});

const toAuthor = (ticket, event, data) => publish(userChannel(id(ticket.authorId)), event, data);
const toAdmins = (event, data) => publish(ADMINS_CHANNEL, event, data);

export const ticketCreated = (ticket, { authorName }) =>
  toAdmins('new_ticket', { ticket: adminTicket(ticket), authorName, createdAt: ticket.createdAt });

export const ticketClassified = (ticket) =>
  toAdmins('ticket_classified', {
    ticket: adminTicket(ticket),
    aiCategory: ticket.aiCategory,
    aiPriority: ticket.aiPriority,
    aiReasoning: ticket.aiReasoning,
    aiConfidence: ticket.aiConfidence,
  });

export const authorReplied = (ticket, message, { reopened, authorName }) =>
  toAdmins('author_reply', {
    ticket: adminTicket(ticket),
    reopened,
    authorName,
    preview: preview(message.body),
    createdAt: message.createdAt,
  });

/**
 * Admin-side change. Admins always get ticket_updated (changes lists which
 * fields moved); the author gets status_changed only when the status changed.
 */
export const ticketUpdated = (ticket, { changes, previousStatus, actorName }) => {
  toAdmins('ticket_updated', { ticket: adminTicket(ticket), changes, previousStatus, actorName });
  if (previousStatus !== undefined && previousStatus !== ticket.status) {
    toAuthor(ticket, 'status_changed', { ticket: authorTicket(ticket), previousStatus });
  }
};

/** A response the author can see; the message must already have its senderId populated. */
export const adminReplied = (ticket, message, { previousStatus, actorName }) => {
  if (message.isInternalNote) throw new Error('Refusing to publish an internal note to an author channel');

  toAuthor(ticket, 'admin_reply', {
    ticket: authorTicket(ticket),
    message: presentMessage(message, { role: ROLES.AUTHOR }),
  });
  ticketUpdated(ticket, { changes: ['reply', ...(previousStatus !== ticket.status ? ['status'] : [])], previousStatus, actorName });
};
