import mongoose from 'mongoose';
import { ROLES, SENDER_ROLES } from './enums.js';

/**
 * One entry in a ticket's conversation thread. The author's original query
 * lives on the Ticket itself; messages are everything after it: admin
 * responses, author follow-ups and admin-only internal notes.
 */
const ticketMessageSchema = new mongoose.Schema(
  {
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    senderRole: { type: String, enum: SENDER_ROLES, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    isInternalNote: { type: Boolean, default: false },
    wasAiDrafted: { type: Boolean, default: false }, // sent response started from an AI draft
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } },
);

ticketMessageSchema.index({ ticketId: 1, createdAt: 1 });

ticketMessageSchema.pre('validate', function adminOnlyFlags() {
  if (this.senderRole !== ROLES.ADMIN && (this.isInternalNote || this.wasAiDrafted)) {
    // invalidate() surfaces as a ValidationError, so the API answers 422, not 500.
    this.invalidate('isInternalNote', 'Only admins can post internal notes or AI-drafted responses');
  }
});

/**
 * The only sanctioned way to read a thread. The viewer's role is required and
 * anyone who is not an admin gets internal notes filtered out in the query
 * itself. It fails closed: a forgotten role argument throws instead of
 * leaking notes.
 */
ticketMessageSchema.statics.findThread = function findThread(ticketId, { viewerRole } = {}) {
  if (!SENDER_ROLES.includes(viewerRole)) {
    throw new Error('findThread requires a valid viewerRole');
  }
  const filter = { ticketId };
  if (viewerRole !== ROLES.ADMIN) filter.isInternalNote = false;
  return this.find(filter).sort({ createdAt: 1 });
};

export const TicketMessage = mongoose.model('TicketMessage', ticketMessageSchema);
