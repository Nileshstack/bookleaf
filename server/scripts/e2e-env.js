// E2E overrides on top of tests/setup/env.js: run the real on-create
// classification path (no API key, so the rule-based fallback answers
// deterministically and ticket_classified events fire) and use fast SSE
// heartbeats.
process.env.AI_CLASSIFY_ON_CREATE = 'true';
process.env.SSE_HEARTBEAT_MS = '150';
