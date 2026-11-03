import { env } from '../config/env.js';
import { AiUsageLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

/** USD cost of one call at the configured per-million-token prices. */
export const estimateCostUsd = ({ promptTokens = 0, completionTokens = 0 }, prices = env.ai.pricePerMTok) =>
  (promptTokens * prices.input + completionTokens * prices.output) / 1_000_000;

/**
 * Usage sink for the AI client: one structured log line plus one DB row per
 * call. The DB write is fire-and-forget, so bookkeeping never slows down or
 * fails an AI call.
 */
export const recordUsage = (record) => {
  const costUsd = estimateCostUsd(record);
  logger.info('ai.usage', { ...record, costUsd: Number(costUsd.toFixed(6)) });
  AiUsageLog.create({ ...record, costUsd }).catch((err) =>
    logger.warn('Failed to persist AI usage', { error: err.message }),
  );
};

const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Aggregated usage for /admin/ai/usage. */
export const usageSummary = async ({ days }) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await AiUsageLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { feature: '$feature', outcome: '$outcome' },
        calls: { $sum: 1 },
        promptTokens: { $sum: '$promptTokens' },
        completionTokens: { $sum: '$completionTokens' },
        cachedPromptTokens: { $sum: '$cachedPromptTokens' },
        costUsd: { $sum: '$costUsd' },
        latencyMs: { $avg: '$latencyMs' },
        tickets: { $addToSet: '$ticketId' },
      },
    },
  ]);

  const emptyFeature = () => ({
    calls: 0,
    success: 0,
    error: 0,
    skipped: 0,
    cacheHits: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    costUsd: 0,
    avgLatencyMs: null,
  });
  const byFeature = { classify: emptyFeature(), draft: emptyFeature() };
  const ticketIds = new Set();

  for (const r of rows) {
    const f = byFeature[r._id.feature];
    const outcomeKey = r._id.outcome === 'cache_hit' ? 'cacheHits' : r._id.outcome;
    f.calls += r.calls;
    f[outcomeKey] += r.calls;
    f.promptTokens += r.promptTokens;
    f.completionTokens += r.completionTokens;
    f.cachedPromptTokens += r.cachedPromptTokens;
    f.costUsd += r.costUsd;
    if (r._id.outcome === 'success') f.avgLatencyMs = Math.round(r.latencyMs);
    for (const id of r.tickets) if (id) ticketIds.add(String(id));
  }

  for (const f of Object.values(byFeature)) {
    f.costUsd = round(f.costUsd, 6);
    f.avgTokensPerSuccess = f.success ? Math.round((f.promptTokens + f.completionTokens) / f.success) : null;
    f.failureRate = f.calls - f.cacheHits > 0 ? round((f.error + f.skipped) / (f.calls - f.cacheHits), 3) : null;
  }
  byFeature.draft.cacheHitRate = byFeature.draft.calls ? round(byFeature.draft.cacheHits / byFeature.draft.calls, 3) : null;

  const totalCost = byFeature.classify.costUsd + byFeature.draft.costUsd;
  return {
    windowDays: days,
    since: since.toISOString(),
    model: env.openai.model,
    pricing: { inputPerMTokUsd: env.ai.pricePerMTok.input, outputPerMTokUsd: env.ai.pricePerMTok.output },
    totals: {
      calls: byFeature.classify.calls + byFeature.draft.calls,
      promptTokens: byFeature.classify.promptTokens + byFeature.draft.promptTokens,
      completionTokens: byFeature.classify.completionTokens + byFeature.draft.completionTokens,
      costUsd: round(totalCost, 6),
      ticketsTouched: ticketIds.size,
      avgCostPerTicketUsd: ticketIds.size ? round(totalCost / ticketIds.size, 6) : null,
    },
    byFeature,
  };
};
