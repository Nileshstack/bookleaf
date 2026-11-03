# Write-up: approach, trade-offs, path to production

## What I prioritised

1. **The core ticket loop, end to end, before polish.** An author raises a ticket, the AI triages it, an admin replies from an AI draft, and the author sees it live. That loop works and is tested: 200 server tests, plus a manual run against the real API and gpt-4o-mini.
2. **AI that is grounded, cheap and never in the way.** The model never sees raw data it could misread. Code computes the facts ("₹850 is below the ₹1,000 minimum", "next payout deadline 14 Nov 2026", "no payout for 27 months, looks overdue"), and the model writes them in BookLeaf's tone. Retrieval sends 1–2 KB sections instead of all 7. Drafts are cached, and every call is metered: about **$0.0005 per ticket**. The AI is also always optional:
   - ticket creation doesn't wait for it
   - outages fall back to keyword rules and reply templates
   - a circuit breaker stops a dead upstream from slowing every request
3. **Correct data boundaries.** Ownership is enforced in queries (another author's ticket is a 404, not a 403). Internal notes fail closed at three layers. Author-facing payloads, including SSE events, are built from whitelists.
4. **The provided edge cases.** Books in production, zero payouts, below-threshold balances and general queries each have explicit handling in the API, the UI and the AI context.

## Trade-offs I made

- **Separate Express API instead of Next.js route handlers.** That's one more deploy, but it keeps the OpenAI key, rate limits and long-lived SSE connections out of the frontend. The cost is cross-site cookies, which I mitigate with an optional same-origin proxy so it works in Safari.
- **SSE over WebSockets.** Traffic is one-way, so SSE is simpler and proxy-friendly, with built-in reconnect. I added event ids and replay, so a dropped connection loses nothing.
- **In-process hub, jobs and circuit breaker.** That's correct and simple for one instance, with each piece behind a clear seam (`publish()`, `runInBackground`, `aiClient`). I didn't add Redis or BullMQ for a demo that runs one instance.
- **A category → section map instead of embeddings.** With 7 KB sections, a map is exact, free and testable. Embeddings pay off once the KB grows.
- **gpt-4o-mini with JSON mode + Zod** instead of a larger model or Structured Outputs: cheaper and portable, and any validation failure lands safely on the rule fallback.
- **Client-side auth guard** instead of Next.js middleware. The session cookie belongs to the API's origin, so the Next server can't read it. The API enforces auth on every request regardless.
- **Attachments are metadata only**, as allowed. I spent the time on AI quality and resilience instead.

## Evolving this into a production system

1. **Scale out safely:** Redis pub/sub behind the event hub, Redis Streams for replay, and BullMQ for classification and draft jobs (retries, dead-letter queue, rate-aware concurrency). Then run more than one API instance behind the load balancer.
2. **Measure and improve the AI:** an evaluation set from the brief plus admin overrides, run in CI on every prompt change. Track category/priority agreement and draft adoption (already recorded), and A/B test prompt versions (already versioned and part of the cache key).
3. **Close the loop with authors:** email notifications, real S3 uploads (photos of print defects), password reset and invites.
4. **Operational maturity:** a per-field audit log, SLA-breach alerts, structured logs shipped to an observability stack (request ids already exist), alerts on AI failure rate and cost, Playwright end-to-end tests in CI, and staging with seeded data.
5. **Richer retrieval:** embeddings over a growing knowledge base and past resolved tickets, kept within the same token budget.
