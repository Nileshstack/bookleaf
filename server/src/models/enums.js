/**
 * Domain vocabulary shared by models, validators and AI prompts. Keeping it
 * in one place means the AI can only ever be asked to pick from values the
 * schema will actually accept.
 */

export const ROLES = Object.freeze({ AUTHOR: 'author', ADMIN: 'admin' });

export const TICKET_STATUSES = Object.freeze(['Open', 'In Progress', 'Resolved', 'Closed']);
// Still needs work from the team; drives the queue order and overdue checks.
export const UNRESOLVED_STATUSES = Object.freeze(['Open', 'In Progress']);

export const TICKET_CATEGORIES = Object.freeze([
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
]);

export const TICKET_PRIORITIES = Object.freeze(['Critical', 'High', 'Medium', 'Low']);

// Lower rank = more urgent. Stored on the ticket so the queue can sort by
// urgency with an index instead of sorting priority labels alphabetically.
export const PRIORITY_RANK = Object.freeze({ Critical: 0, High: 1, Medium: 2, Low: 3 });

export const AI_STATUSES = Object.freeze(['pending', 'done', 'failed']);

export const SENDER_ROLES = Object.freeze([ROLES.AUTHOR, ROLES.ADMIN]);

// Attachments are metadata-only for now; these limits are enforced at the
// API so the UI and a future real upload pipeline share the same rules.
export const ATTACHMENT_LIMITS = Object.freeze({
  maxFiles: 5,
  maxSizeBytes: 10 * 1024 * 1024,
  mimeTypes: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
});
