# QA checklist and results

Run against a local build connected to MongoDB Atlas with the real `gpt-4o-mini` key, on 3 Nov 2026. ✅ = verified, ⚠️ = verified with a stated limitation, ⏳ = needs the deployed environment.

## Automated

| Check | Result |
|---|---|
| Server test suite: `npm test --prefix server` (Jest + supertest + in-memory MongoDB, OpenAI mocked) | ✅ **200 / 200** in 15 suites |
| OpenAPI spec ↔ route table, both directions (`tests/openapi.test.js`) | ✅ 23 operations, none missing or stale; every `$ref` resolves |
| Client type-check, ESLint (Next + React Compiler rules), production build | ✅ clean |
| Mutation checks: core guarantees deliberately broken to confirm the tests catch them (ownership, RBAC, internal-note filtering, AI decoupling, closed-ticket replies, queue sort, override tracking, seed ages, retrieval, retries, classification lease, SSE leakage/replay) | ✅ every mutation failed at least one test |

## Scripted API QA (running server, real data): 30 / 30

Health and security headers (helmet, no `x-powered-by`, `X-Request-Id`) · Swagger UI and the OpenAPI JSON served · wrong password / unknown email give identical 401s · invalid login body 422 with field details · no token 401 · author on admin route 403 · admin on author route 403 · another author's ticket and book 404, with the same message as a missing one · empty ticket 422 (`subject`, `description`) · ticket on another author's book 422 (`bookId`) · bad query 400 · malformed JSON 400 · unknown route JSON 404 · in-production book returns `null` figures and stage "Typesetting, step 4" · ₹850 pending flagged as below the ₹1,000 minimum · author ticket JSON has no priority / AI / note / assignee fields · admin priority filter · queue `ageHours` / `isOverdue` · stats · PATCH with an unknown field 422 · AI usage summary (circuit closed) · disallowed CORS origin 403 · allowed origin gets credentialed CORS headers · author SSE stream opens with `ready`.

## Manual browser QA (built-in browser, real API + real AI)

| Flow | Result |
|---|---|
| Login: demo panel fill, role redirect; `?next=` ignored across roles | ✅ |
| Author dashboard totals match the dataset (Sneha: 2,290 copies, ₹60,865 earned, ₹53,000 paid, ₹7,865 pending) | ✅ |
| Book in production: "—" not ₹0, stepper "Cover Design, step 3 of 9" | ✅ |
| New ticket: inline validation, focus on the first error, label/aria wiring, `?bookId` preselect, create then redirect | ✅ |
| Author thread: live admin reply plus status toast without refresh; internal note never shown; Ctrl+Enter reply | ✅ |
| Mobile width (375 px): top bar + menu, single column, no horizontal scroll | ✅ |
| Admin dashboard: stat cards, charts, AI health and cost, attention list | ✅ |
| **End to end:** author submits → the admin queue shows it live (toast, "1 new" badge, slide-in) → AI classifies it (Royalty & Payments / High, ~1 s) → admin opens it, AI draft auto-loads (real figures, overdue apology, 48 h) → admin edits and sends → the author's stream receives `admin_reply` (with the edit) + `status_changed`, no internal fields → the author's thread shows the reply | ✅ ⚠️ the author side of the live step was recorded as an SSE stream (one browser can't hold two sessions); the author's live UI was verified separately |
| AI outage: draft 503 → "AI unavailable: write manually" banner, Insert template, controls and Send still work | ⚠️ the 503 was injected in the browser (the real API wasn't taken down) |
| Same-origin proxy mode (`API_PROXY_TARGET`): login cookie first-party, `/auth/me`, SSE through the Next proxy | ✅ via `next start` locally |
| Swagger UI under helmet CSP | ⚠️ checked statically (same-origin scripts only, inline styles allowed, assets 200); not viewed in a browser |
| Console: no runtime errors on a fresh tab | ✅ |

## Security audit

| Check | Result |
|---|---|
| Real `OPENAI_API_KEY`, `JWT_SECRET` and Atlas password searched across all tracked files | ✅ not found |
| …across the **entire git history** (`git log -p --all`) | ✅ not found |
| …and in the production client bundle (`client/.next/static`) | ✅ not found; the bundle doesn't even mention `OPENAI`, `JWT_SECRET` or `MONGODB` |
| `sk-` key patterns / credentialed `mongodb+srv` URIs in the repo | ✅ none (only the fake `sk-test-not-real` in tests) |
| Env files tracked | ✅ only `server/.env.example`, `client/.env.example` |
| Client source referencing server secrets | ✅ none |

## Bugs found and fixed along the way

- **Seed kept stale ticket ages on re-runs.** Mongoose treats `createdAt` as immutable; the fix is `overwriteImmutable`, with a regression test.
- **Admin draft never appeared in dev.** An unmount-abort raced React Strict Mode / Activity remounts; in-flight drafts now land.
- **Duplicate AI classification** under overlapping restarts / several instances. Fixed with an atomic classification lease, plus a concurrency test.
- **Cramped layouts at 1024 px** (dashboard side column, two-column book cards). Columns now start at `xl`.
- **Cross-site cookies blocked by Safari** in a split Vercel/Render deploy. Added an optional same-origin proxy mode and a `TRUST_PROXY_HOPS` setting, so rate limits still see real client IPs.

## Needs the deployed environment

- ⏳ Health, docs, login and live updates on the Vercel + Render URLs (checklist in DEPLOYMENT.md §5)
- ⏳ Safari sign-in with the proxy mode
- ⏳ SSE connection longevity through Vercel's edge
