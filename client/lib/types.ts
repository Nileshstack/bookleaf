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
