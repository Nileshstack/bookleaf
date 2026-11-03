import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/**
 * Single source of truth for runtime configuration.
 * Everything is validated once at boot so a misconfigured deploy fails fast
 * with a readable message instead of crashing later on first use.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Optional on purpose: without a key the app still runs and AI features
  // degrade to manual classification / manual responses.
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Resilience. Worst case per call: (retries + 1) × timeout plus backoff.
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  AI_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),
  // Kill switch for automatic triage on ticket creation. When false, new tickets stay aiStatus 'pending'
  // until an admin runs POST /admin/tickets/:id/classify. The test suite sets it false so suites unrelated
  // to AI see deterministic tickets.
  AI_CLASSIFY_ON_CREATE: z.enum(['true', 'false']).default('true'),
  // USD per 1M tokens, for cost estimates in usage logs. Defaults are gpt-4o-mini list prices; verify on openai.com/pricing.
  AI_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0.15),
  AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0.6),

  // Comma-separated list of allowed browser origins.
  CLIENT_URL: z.string().default('http://localhost:3000'),

  // Server-Sent Events: comment heartbeat interval (keeps proxies from closing idle streams) and per-user stream cap.
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(25_000),
  SSE_MAX_STREAMS_PER_USER: z.coerce.number().int().positive().default(5),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = Object.freeze({
  nodeEnv: raw.NODE_ENV,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  mongoUri: raw.MONGODB_URI,
  jwt: { secret: raw.JWT_SECRET, expiresIn: raw.JWT_EXPIRES_IN },
  openai: {
    apiKey: raw.OPENAI_API_KEY,
    model: raw.OPENAI_MODEL,
    enabled: raw.OPENAI_API_KEY.length > 0,
  },
  ai: {
    timeoutMs: raw.AI_TIMEOUT_MS,
    maxRetries: raw.AI_MAX_RETRIES,
    breakerThreshold: raw.AI_BREAKER_THRESHOLD,
    breakerCooldownMs: raw.AI_BREAKER_COOLDOWN_MS,
    classifyOnCreate: raw.AI_CLASSIFY_ON_CREATE === 'true',
    pricePerMTok: { input: raw.AI_PRICE_INPUT_PER_MTOK, output: raw.AI_PRICE_OUTPUT_PER_MTOK },
  },
  sse: { heartbeatMs: raw.SSE_HEARTBEAT_MS, maxStreamsPerUser: raw.SSE_MAX_STREAMS_PER_USER },
  clientUrls: raw.CLIENT_URL.split(',').map((u) => u.trim()).filter(Boolean),
  rateLimit: { windowMs: raw.RATE_LIMIT_WINDOW_MS, max: raw.RATE_LIMIT_MAX },
});
