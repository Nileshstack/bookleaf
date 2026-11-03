import mongoose from 'mongoose';

/**
 * One row per logical AI call, including failures, skips (circuit open or
 * AI disabled) and draft cache hits. That's enough to answer "what does AI
 * cost us per ticket?" and "how often does it fail?" without an external
 * observability stack. Rows expire after 90 days.
 */
const aiUsageLogSchema = new mongoose.Schema(
  {
    feature: { type: String, enum: ['classify', 'draft'], required: true },
    outcome: { type: String, enum: ['success', 'error', 'skipped', 'cache_hit'], required: true },
    model: { type: String, default: null },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    cachedPromptTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: null },
    attempts: { type: Number, default: null },
    errorCode: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

aiUsageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
aiUsageLogSchema.index({ feature: 1, createdAt: -1 });

export const AiUsageLog = mongoose.model('AiUsageLog', aiUsageLogSchema);
