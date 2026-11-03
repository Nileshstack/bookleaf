import mongoose from 'mongoose';

/**
 * Cached AI draft reply, one per ticket. Opening the same ticket again
 * returns this instead of calling the LLM again. contextHash fingerprints
 * the inputs the draft was built from (ticket text, thread, category). When
 * those change the hash no longer matches and the draft is regenerated.
 */
const aiDraftSchema = new mongoose.Schema(
  {
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, unique: true },
    draftText: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now },
    model: { type: String, required: true },
    contextHash: { type: String, required: true },
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
  },
  { toJSON: { versionKey: false } },
);

export const AiDraft = mongoose.model('AiDraft', aiDraftSchema);
