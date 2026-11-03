import { createAiClient } from './client.js';
import { recordUsage } from './usage.js';

/** Process-wide AI client: one circuit breaker shared by every feature. */
export const aiClient = createAiClient({ onUsage: recordUsage });

export { AiOutputError, AiUnavailableError } from './errors.js';
