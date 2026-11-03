import { isAdmin } from './access.js';

/**
 * Role-aware response shaping. Authors see their query, status, category and
 * the conversation. They never see triage internals: priority, AI
 * suggestions and reasoning, override flags, assignee, or internal notes.
 * A "Low" label on someone's royalty question is an internal triage call,
 * not something to show them.
 */

const presentBook = (book) => (book ? { _id: book._id, bookId: book.bookId, title: book.title } : null);

const presentPerson = (person) => (person ? { _id: person._id, name: person.name, email: person.email } : null);

export const presentTicket = (ticket, viewer) => {
  const base = {
    _id: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    description: ticket.description,
    attachments: ticket.attachments,
    status: ticket.status,
    category: ticket.category,
    book: presentBook(ticket.bookId),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };

  if (!isAdmin(viewer)) return base;

  return {
    ...base,
    author: ticket.authorId?.name ? { ...presentPerson(ticket.authorId), authorCode: ticket.authorId.authorCode } : null,
    priority: ticket.priority,
    aiCategory: ticket.aiCategory,
    categoryOverridden: ticket.categoryOverridden,
    aiPriority: ticket.aiPriority,
    priorityOverridden: ticket.priorityOverridden,
    aiReasoning: ticket.aiReasoning,
    aiConfidence: ticket.aiConfidence ?? null,
    classificationSource: ticket.classificationSource ?? null,
    aiStatus: ticket.aiStatus,
    aiError: ticket.aiError,
    assignedTo: presentPerson(ticket.assignedTo),
  };
};

export const presentMessage = (message, viewer) => {
  const base = {
    _id: message._id,
    senderRole: message.senderRole,
    senderName: message.senderId?.name ?? null,
    body: message.body,
    createdAt: message.createdAt,
  };
  return isAdmin(viewer)
    ? { ...base, isInternalNote: message.isInternalNote, wasAiDrafted: message.wasAiDrafted }
    : base;
};
