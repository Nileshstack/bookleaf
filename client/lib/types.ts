/**
 * Types for the API's author-facing responses. These mirror the server's
 * presenters. Authors never receive priority, AI fields or internal notes,
 * so those fields don't exist here at all.
 */

export type Role = "author" | "admin";

export interface User {
  _id: string;
  role: Role;
  name: string;
  email: string;
  authorCode: string | null;
  phone: string | null;
  city: string | null;
  joinedDate: string | null;
}

export type PayoutStatus =
  | "not_yet_published"
  | "no_earnings_yet"
  | "awaiting_first_payout"
  | "partially_paid"
  | "fully_paid";

export interface RoyaltyBreakdown {
  payoutStatus: PayoutStatus;
  royaltyPerCopy: number | null;
  copiesSold: number | null;
  totalEarned: number | null;
  paid: number | null;
  pending: number | null;
  paidPercentage: number | null;
  meetsPayoutThreshold: boolean | null;
  rollsOverToNextQuarter: boolean | null;
  payoutThreshold: number;
  lastPayoutDate: string | null;
  nextScheduledPayout: { quarterEnd: string; payoutBy: string } | null;
}

export interface ProductionProgress {
  currentStage: string;
  stepNumber: number | null;
  totalSteps: number;
  stages: string[];
}

export interface Book {
  _id: string;
  bookId: string;
  title: string;
  isbn: string;
  genre: string | null;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  royaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
  isPublished: boolean;
  royaltyBreakdown: RoyaltyBreakdown;
  production: ProductionProgress;
}

export const TICKET_STATUSES = ["Open", "In Progress", "Resolved", "Closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CATEGORIES = [
  "Royalty & Payments",
  "ISBN & Metadata Issues",
  "Printing & Quality",
  "Distribution & Availability",
  "Book Status & Production Updates",
  "General Inquiry",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export interface Attachment {
  fileName: string;
  sizeBytes: number | null;
  mimeType: string | null;
  url: string | null;
}

export interface Message {
  _id: string;
  senderRole: Role;
  senderName: string | null;
  body: string;
  createdAt: string;
}

export interface Ticket {
  _id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  attachments: Attachment[];
  status: TicketStatus;
  category: TicketCategory | null;
  book: { _id: string; bookId: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketListItem extends Ticket {
  messageCount: number;
  lastMessage: { senderRole: Role; preview: string; createdAt: string } | null;
  lastActivityAt: string;
}

export interface TicketDetail extends Ticket {
  messages: Message[];
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FieldError {
  field: string | null;
  message: string;
}

/** SSE payloads on the author stream. */
export interface AuthorTicketRef {
  ticketId: string;
  ticketNumber: string;
  status: TicketStatus;
  updatedAt: string;
}
export interface AdminReplyEvent {
  ticket: AuthorTicketRef;
  message: Message;
}
export interface StatusChangedEvent {
  ticket: AuthorTicketRef;
  previousStatus: TicketStatus;
}

// ---------------------------------------------------------------------------
// Admin. These shapes are only ever returned to admin sessions.
// ---------------------------------------------------------------------------

export const TICKET_PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type AiStatus = "pending" | "done" | "failed";

export interface Person {
  _id: string;
  name: string;
  email: string;
  authorCode?: string | null;
}

export interface AdminMessage extends Message {
  isInternalNote: boolean;
  wasAiDrafted: boolean;
}

export interface AdminTicketBase extends Ticket {
  author: Person | null;
  priority: TicketPriority | null;
  aiCategory: TicketCategory | null;
  categoryOverridden: boolean;
  aiPriority: TicketPriority | null;
  priorityOverridden: boolean;
  aiReasoning: string | null;
  aiConfidence: number | null;
  classificationSource: "ai" | "rules" | null;
  aiStatus: AiStatus;
  aiError: string | null;
  assignedTo: Person | null;
  ageHours: number;
  slaHours: number;
  dueAt: string;
  isOverdue: boolean;
}

export interface QueueItem extends AdminTicketBase {
  messageCount: number;
  lastMessage: { senderRole: Role; isInternalNote: boolean; preview: string; createdAt: string } | null;
  awaitingTeamResponse: boolean;
}

export interface AuthorProfile {
  _id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  authorCode: string | null;
  joinedDate: string | null;
  books: { total: number; published: number; totalRoyaltyEarned: number; royaltyPaid: number; royaltyPending: number };
  tickets: { total: number; unresolved: number };
}

export interface AdminTicketDetail extends Omit<AdminTicketBase, "book"> {
  messages: AdminMessage[];
  authorProfile: AuthorProfile | null;
  book: Book | null;
  otherOpenTickets: {
    count: number;
    items: { _id: string; ticketNumber: string; subject: string; status: TicketStatus; priority: TicketPriority | null }[];
  };
}

export type CountMap = Record<string, number>;

export interface AdminStats {
  total: number;
  byStatus: CountMap;
  byCategory: CountMap;
  byPriority: CountMap;
  unresolved: {
    count: number;
    averageAgeHours: number | null;
    overdue: number;
    unassigned: number;
    byCategory: CountMap;
    byPriority: CountMap;
  };
  ai: {
    classification: { pending: number; failed: number; done: number };
    category: { suggested: number; overridden: number; overrideRate: number | null };
    priority: { suggested: number; overridden: number; overrideRate: number | null };
    drafts: { repliesSent: number; aiDrafted: number; adoptionRate: number | null };
  };
}

export interface AiUsageSummary {
  windowDays: number;
  totals: { calls: number; costUsd: number; ticketsTouched: number; avgCostPerTicketUsd: number | null };
  client: { enabled: boolean; circuit: "closed" | "open" | "half-open" };
}

export interface AiDraft {
  draftText: string;
  generatedAt: string;
  model: string;
  cached: boolean;
  warnings: string[];
  context: { category: string | null; sections: string[]; exampleId: string | null };
}

/** SSE payloads on the admin stream. */
export interface AdminTicketRef {
  ticketId: string;
  ticketNumber: string;
  status: TicketStatus;
  subject: string;
  category: TicketCategory | null;
  priority: TicketPriority | null;
  aiStatus: AiStatus;
  classificationSource: "ai" | "rules" | null;
  assignedTo: string | null;
  authorId: string | null;
  updatedAt: string;
}

export type AdminLiveEvent =
  | { type: "new_ticket"; data: { ticket: AdminTicketRef; authorName: string } }
  | { type: "ticket_classified"; data: { ticket: AdminTicketRef; aiReasoning: string | null } }
  | { type: "author_reply"; data: { ticket: AdminTicketRef; preview: string; reopened: boolean; authorName: string } }
  | { type: "ticket_updated"; data: { ticket: AdminTicketRef; changes: string[]; actorName: string } }
  | { type: "resync" };
