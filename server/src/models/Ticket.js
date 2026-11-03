import mongoose from 'mongoose';
import { Counter } from './Counter.js';
import {
  AI_STATUSES,
  PRIORITY_RANK,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  UNRESOLVED_STATUSES,
} from './enums.js';

const isUnresolvedStatus = (status) => UNRESOLVED_STATUSES.includes(status);

// Unclassified tickets sort alongside Medium: they shouldn't jump the queue
// on a guess, but they shouldn't be buried either.
const UNCLASSIFIED_RANK = PRIORITY_RANK.Medium;
const rankOf = (priority) => (priority ? PRIORITY_RANK[priority] : UNCLASSIFIED_RANK);

const formatTicketNumber = (seq) => `BL-${String(seq).padStart(4, '0')}`;

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, trim: true, default: null },
    sizeBytes: { type: Number, min: 0, default: null },
    url: { type: String, default: null }, // stays null until real uploads exist
  },
  { _id: false },
);

/**
 * category / priority are the values the team works with. The ai* fields keep
 * what the model suggested, and the *Overridden flags record that an admin
 * disagreed. That keeps an audit trail and gives a measure of AI accuracy.
 * A null category/priority means the ticket has not been classified yet.
 */
const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true }, // BL-0001, assigned on create
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', default: null }, // null = General / Account Level

    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    attachments: {
      type: [attachmentSchema],
      default: [],
      validate: [(v) => v.length <= 5, 'A ticket can have at most 5 attachments'],
    },

    status: { type: String, enum: TICKET_STATUSES, default: 'Open' },
    isUnresolved: { type: Boolean, default: true }, // derived from status (Open / In Progress), see hooks

    category: { type: String, enum: [...TICKET_CATEGORIES, null], default: null },
    aiCategory: { type: String, enum: [...TICKET_CATEGORIES, null], default: null },
    categoryOverridden: { type: Boolean, default: false },

    priority: { type: String, enum: [...TICKET_PRIORITIES, null], default: null },
    priorityRank: { type: Number, default: UNCLASSIFIED_RANK }, // derived from priority, see hooks
    aiPriority: { type: String, enum: [...TICKET_PRIORITIES, null], default: null },
    priorityOverridden: { type: Boolean, default: false },
    aiReasoning: { type: String, maxlength: 1000, default: null },

    aiStatus: { type: String, enum: AI_STATUSES, default: 'pending' },
    aiError: { type: String, maxlength: 500, default: null }, // why classification failed, for ops visibility

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

// Default admin queue: unresolved first, then most urgent, then oldest.
ticketSchema.index({ isUnresolved: -1, priorityRank: 1, createdAt: 1 });
// Same order when the queue is filtered by status.
ticketSchema.index({ status: 1, priorityRank: 1, createdAt: 1 });
// Author's "My Tickets".
ticketSchema.index({ authorId: 1, createdAt: -1 });
ticketSchema.index({ category: 1, createdAt: -1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
// Finding tickets whose AI classification is still pending or failed (retry).
ticketSchema.index({ aiStatus: 1, createdAt: 1 });

ticketSchema.pre('validate', async function assignDerivedFields() {
  if (this.isNew && !this.ticketNumber) {
    this.ticketNumber = formatTicketNumber(await Counter.next('ticketNumber'));
  }
  if (this.isNew || this.isModified('priority')) {
    this.priorityRank = rankOf(this.priority);
  }
  if (this.isNew || this.isModified('status')) {
    this.isUnresolved = isUnresolvedStatus(this.status);
  }
});

// Keep the derived fields in sync when status/priority change through a
// query update instead of doc.save().
ticketSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function syncDerivedFields() {
  const update = this.getUpdate() ?? {};
  const read = (field) => (update.$set?.[field] !== undefined ? update.$set[field] : update[field]);

  const priority = read('priority');
  if (priority !== undefined) this.set('priorityRank', rankOf(priority));

  const status = read('status');
  if (status !== undefined) this.set('isUnresolved', isUnresolvedStatus(status));
});

/**
 * Recomputes the derived fields for every ticket. Used by the seed to
 * backfill documents written before a derived field existed. Idempotent.
 */
ticketSchema.statics.syncDerivedFields = async function syncDerivedFieldsForAll() {
  await this.collection.bulkWrite([
    { updateMany: { filter: { status: { $in: UNRESOLVED_STATUSES } }, update: { $set: { isUnresolved: true } } } },
    { updateMany: { filter: { status: { $nin: UNRESOLVED_STATUSES } }, update: { $set: { isUnresolved: false } } } },
    ...[...TICKET_PRIORITIES, null].map((priority) => ({
      updateMany: { filter: { priority }, update: { $set: { priorityRank: rankOf(priority) } } },
    })),
  ]);
};

ticketSchema.statics.formatTicketNumber = formatTicketNumber;

export const Ticket = mongoose.model('Ticket', ticketSchema);
