# Architecture (draft)

> Status: backend complete (auth, author + admin APIs, AI layer, SSE). Frontend: author portal done; admin console next.

## Overview

```
bookleafs/
├── client/   Next.js (App Router) + Tailwind, author and admin portals
└── server/   Node.js + Express 5 REST API, MongoDB via Mongoose, OpenAI
```

The repo has two independently deployable apps. They share only the HTTP contract (`/api/v1`), so the frontend can go to Vercel and the API to Render or Railway without either knowing how the other is hosted.

Why not Next.js API routes alone? The brief asks for a clean REST layer with auth, RBAC and documentation, and real-time updates over SSE. A separate Express process keeps long-lived SSE connections, rate limiting and the OpenAI key out of the frontend's runtime entirely, and keeps the API testable on its own.

## Server layers

```
server/src/
├── config/       env validation (zod), Mongo connection, CORS policy
├── routes/       URL → middleware chain → controller. No logic.
├── controllers/  Read req, call a service, shape the HTTP response.
├── services/     Business rules (ticket lifecycle, ownership checks).
├── models/       Mongoose schemas and indexes.
├── validators/   Request schemas (zod), run by middleware before controllers.
├── middleware/   requestId, auth/RBAC, rate limiting, error handling.
├── ai/           Prompts, knowledge base, OpenAI client. The only code that talks to the LLM.
├── utils/        AppError, logger, response helpers.
├── seed/         data.json (provided dataset), demo tickets, idempotent seed script.
├── app.js        Builds the Express app (no port binding, so it is importable in tests).
└── server.js     Boot: validate env → connect DB → listen → graceful shutdown.
```

Dependencies point one way: `routes → controllers → services → models / ai`. Controllers never touch Mongoose directly, and services never touch `req`/`res`. That keeps business logic testable without HTTP, and keeps the AI module swappable (for example, a different provider) without touching ticket code.

## Request pipeline

`requestId → helmet → cors → json body (100kb) → cookieParser → morgan → /api/v1 router → [health] → apiLimiter → [auth/login, auth/logout] → authenticate → feature routes → notFound → errorHandler`

- `/api/v1/health` sits before the rate limiter so uptime probes are never throttled. It returns 503 if Mongo is down. A missing OpenAI key is reported as `ai: "disabled"`, not as a failure.
- Express 5 forwards rejected promises from async handlers to the error middleware, so there is no `asyncHandler` wrapper boilerplate.

## Error contract

Every error leaves the API in one shape:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "requestId": "..." } }
```

- `details` is always an array: `[{ field, message }]` for validation errors, otherwise `[]`.
- Throw `AppError` (or its factories, such as `AppError.notFound('Ticket')`) for expected failures.
- `errorHandler` maps Zod, Mongoose (validation, cast, duplicate key), JWT and body-parser errors to proper 4xx codes.
- Request validation: `validate({ params, query, body })` runs Zod schemas from `validators/` and puts the parsed values on `req.validated`, which is all controllers read. A bad body gives **422** `VALIDATION_ERROR`. A bad URL (params/query) gives **400** `VALIDATION_ERROR`. Unparseable JSON gives **400** `BAD_REQUEST`.

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` / `VALIDATION_ERROR` | Malformed JSON; invalid path or query params |
| 401 | `UNAUTHORIZED` / `INVALID_CREDENTIALS` | No token, bad/expired token, deleted account / wrong login |
| 403 | `FORBIDDEN` | Authenticated, but the role isn't allowed on this route |
| 404 | `NOT_FOUND` | Doesn't exist, **or belongs to another author** |
| 422 | `VALIDATION_ERROR` | Well-formed body with invalid values |
| 429 | `RATE_LIMITED` | Rate limit hit |
- Anything unrecognised is logged with its stack and the request id, then returned as a generic `INTERNAL_ERROR`. Internals never leak in production.
- Successes use `{ success: true, data, meta? }`.

## Configuration and secrets

- `config/env.js` validates `process.env` once at boot and exits with a readable list of problems if anything is wrong.
- `OPENAI_API_KEY` exists only in `server/.env`. The client has only `NEXT_PUBLIC_API_URL`. Every AI call is proxied through the API, so the key is never in a browser bundle.
- `.env*` files are gitignored; only `.env.example` templates are committed.

## Security baseline

- `helmet` sets security headers.
- CORS uses an allow-list (`CLIENT_URL`, comma-separated). Rejected origins get a JSON 403.
- Rate limits: a global per-IP limiter, a strict `authLimiter` for login (10 failed attempts per 15 min), and an `aiLimiter` for endpoints that cost money.
- `trust proxy` is on in production so limits key on the real client IP behind the PaaS proxy.

## Authentication and access control

**Login**: `POST /auth/login` checks the bcrypt hash and issues an HS256 JWT holding only `{ sub: userId, role }`.
- The JWT is set as an `httpOnly` cookie (`bl_token`), so page scripts can't read it.
- The cookie is `SameSite=Lax` locally. In production it is `SameSite=None; Secure`, because the client and API are on different sites.
- The token is also returned in the body so Postman can use `Authorization: Bearer <token>`. When both are present, the header wins.
- Wrong password and unknown email give the same 401 with the same message. Unknown emails still run a bcrypt compare, so response timing doesn't reveal which accounts exist.
- `POST /auth/logout` is public, so a user with an expired token can still clear the cookie.

**`authenticate`** guards every route except health, login and logout. It verifies the JWT with the algorithm pinned and then loads the user from the DB. That costs one indexed read per request, so deleting an account or changing a role takes effect immediately instead of when the token expires.

**`authorize(...roles)`** is the role gate. For example, `/users` is admin-only and gives an author a 403.

**Ownership** lives in the query, not in a check after the fetch. `scopeToOwner(user, filter)` adds `authorId: user.id` for authors, and every book and ticket read goes through it.
- List endpoints can never return another author's rows.
- A lookup for another author's ticket matches nothing and returns the **same 404** (same message) as a missing ticket. A 403 would confirm the id exists.
- Middleware that fetches the record and then compares owners does the same job, but it's easy to forget on list routes and needs an extra query.

**Response shaping** (`services/presenters.js`): authors never receive priority, AI suggestions or reasoning, override flags, the assignee or internal notes. Internal notes are also excluded at the query level by `TicketMessage.findThread`.

**CSRF**: the API parses only `application/json`, with no urlencoded parser. Cross-site forms can't send JSON without a CORS preflight, and the origin allow-list rejects that preflight. So cookie-authenticated writes can't be forged from another site.

### Endpoints so far (`/api/v1`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/health` | public | 503 when DB is down |
| POST | `/auth/login` | public, `authLimiter` | `{ email, password }` → `{ user, token }` + cookie |
| POST | `/auth/logout` | public | Clears the cookie |
| GET | `/auth/me` | any role | Current user |
| GET | `/books` | author | Own books + `isPublished`, `royaltyBreakdown`, `production` |
| GET | `/books/:bookId` | author (owner) | Mongo id or `BK001` |
| POST | `/tickets` | author | 201 + `Location`. Per-author `ticketCreationLimiter` (20/h) |
| GET | `/tickets` | author | Own tickets, newest first, `?status&category&page&limit`, with `lastMessage` preview + `messageCount` |
| GET | `/tickets/stream` | author | SSE: `admin_reply`, `status_changed` (own tickets only) |
| GET | `/tickets/:ticketId` | author (owner) | Mongo id or `BL-0001`; thread without internal notes |
| POST | `/tickets/:ticketId/messages` | author (owner) | Follow-up; Resolved → Open; Closed → 409 `TICKET_CLOSED` |
| GET | `/users` | admin | `?role&page&limit` |
| GET | `/admin/tickets` | admin | Queue with filters, search, sort and pagination; see below |
| GET | `/admin/tickets/stream` | admin | SSE: `new_ticket`, `ticket_classified`, `author_reply`, `ticket_updated` |
| GET | `/admin/tickets/:ticketId` | admin | Full detail: thread incl. internal notes, author profile, book insights, other open tickets |
| PATCH | `/admin/tickets/:ticketId` | admin | `{ status?, category?, priority?, assignedTo? }`; strict: unknown keys give 422 |
| POST | `/admin/tickets/:ticketId/assign-to-me` | admin | Idempotent; returns `previousAssigneeId` |
| POST | `/admin/tickets/:ticketId/notes` | admin | `{ body }` → internal note (never sent to the author) |
| POST | `/admin/tickets/:ticketId/reply` | admin | `{ body, wasAiDrafted?, status? }` |
| GET | `/admin/stats` | admin | Counts, open-ticket age, overdue, AI override and draft-adoption rates |
| POST | `/admin/tickets/:ticketId/draft` | admin, `aiLimiter` | AI draft (cached); `?regenerate=true`; 503 + template if AI unavailable |
| POST | `/admin/tickets/:ticketId/classify` | admin, `aiLimiter` | Re-run triage now (respects admin overrides) |
| GET | `/admin/ai/usage` | admin | `?days=30`: tokens, cost, failures, cache hits, cost per ticket, breaker state |

`/books` and `/tickets` are the **author portal** (admins get 403). The admin queue will get its own `/admin/...` routes, so each portal's rules and response shape stay in one place instead of branching on role inside shared handlers.

### Author portal behaviour

- **Book edge cases**: `services/bookInsights.js` derives everything from BookLeaf policy as pure functions, which the AI prompt builder can reuse.
  - Books in production return `null` for MRP, royalty and publication date, never `0`. "No price yet" is not the same as "earned nothing".
  - `payoutStatus` is one of `not_yet_published | no_earnings_yet | awaiting_first_payout | partially_paid | fully_paid`.
  - `meetsPayoutThreshold` / `rollsOverToNextQuarter` reflect the ₹1,000 minimum payout.
  - `nextScheduledPayout` is the next quarter-end + 45-day deadline. It's a schedule date, not a promise about a specific balance.
  - `production` gives the pipeline stage, e.g. Cover Design, step 3 of 9.
- **Creating a ticket**:
  - Only `bookId`, `subject`, `description` and `attachments` are accepted. Unknown keys are stripped, so an author can't set status, priority or `authorId`.
  - `bookId` may be missing, `null` or `""` for General / Account Level. A book that doesn't exist and another author's book both give the same 422 on `bookId`.
  - Attachments are metadata only: at most 5 files, up to 10 MB each, images/PDF/Word/text.
- **AI never blocks ticket creation**: the ticket is saved and the 201 sent first. `classifyTicket` then runs through `runInBackground`, and its errors are logged, never propagated. Tests prove creation still returns 201 when the AI service throws, and returns immediately when it hangs. A ticket the AI never processed stays `aiStatus: 'pending'`, so it can be recovered later.
- **Replies**: a Resolved ticket reopens because the author is saying it isn't fixed. A Closed ticket returns 409 and tells the author to open a new ticket.
- **List previews**: one aggregation per page (`TicketMessage.latestVisibleByTicket`) returns each ticket's latest visible message and count. It applies the same fail-closed internal-note rule as `findThread`.

### Admin portal behaviour

**Queue (`GET /admin/tickets`)**
- **Default sort `queue`**: unresolved (Open / In Progress) first, then most urgent, then oldest; Resolved and Closed come last. It is served by the index `{ isUnresolved: -1, priorityRank: 1, createdAt: 1 }`. Other sorts: `newest`, `oldest`, `updated`. `_id` breaks ties so pages are stable.
- **Filters**:
  - `status`, `category`, `priority` and `aiStatus` take one value, a comma list, or a repeated param.
  - `authorId` takes a Mongo id or `AUTH001`.
  - `assignedTo` takes `me`, `unassigned` or an admin id.
  - `from` / `to` take `YYYY-MM-DD` (a date-only `to` covers the whole UTC day) or ISO timestamps.
  - `overdue=true|false`.
  - `q` is a literal, case-insensitive search over subject, description, ticket number, author name/email and book title. It is regex-escaped.
  - Invalid values give 400, naming the field, e.g. `priority.1` for the second item in a list.
- **Computed per item**:
  - `ageHours`, `slaHours`, `dueAt` and `isOverdue`. `isOverdue` means unresolved and older than the response target: Critical 24h, High 48h (both from the brief), Medium 96h, Low 168h. Unclassified tickets use Medium's target.
  - `lastMessage`: the team view, including notes.
  - `awaitingTeamResponse`: nobody has replied yet, or the author spoke last.
  - The overdue rule exists in two forms: `ticketTiming()` in JS and `overdueFilter()` as a Mongo query. Filtering and stats use the database instead of loading tickets.

**AI overrides (`PATCH`)**
- `categoryOverridden` / `priorityOverridden` are true when the admin's value differs from the AI's suggestion. Setting it back to the AI's value clears the flag.
- If the AI never made a suggestion, an admin-set value is still flagged. That marks it as a human decision a late AI result must not overwrite.
- `aiCategory` and `aiPriority` are never modified by admins, so accuracy can be measured later.
- `/admin/stats` reports the override rate only over tickets the AI actually classified. Manual triage after an AI outage therefore doesn't count as the AI being wrong.

**Reply defaults**
- Without an explicit `status`, replying to an Open ticket moves it to In Progress.
- An unassigned ticket is assigned to the replying admin.
- A Closed ticket returns 409 unless the reply includes a `status` that reopens it.
- `wasAiDrafted` is recorded per reply, and stats report the draft adoption rate.

**Stats**
- `byStatus`, `byCategory` and `byPriority` include every key, with `Unclassified` for null.
- `unresolved` has `{ count, averageAgeHours, overdue, unassigned }`.
- `ai` has the classification status counts, category/priority override rates and draft adoption.
- Everything comes from one `$facet` aggregation plus one over messages.

## Testing

`npm test` in `server/` runs Jest + supertest against the real Express app and a throwaway **mongodb-memory-server** instance. One server is shared per run, and each test file gets its own database. `tests/setup/env.js` sets the env before any import, so tests can never touch Atlas or OpenAI. The suites cover:
- login success, wrong password, unknown email, 422 field details and malformed JSON
- missing, tampered, wrongly signed and expired tokens, and a token for a deleted account
- cookie and Bearer auth, and logout
- one author reading another's ticket or book (404, indistinguishable from missing), internal notes and triage fields hidden from authors
- an author on an admin route (403)
- the login rate limit
- the ticket lifecycle: create (General or a book), mass-assignment protection, attachment rules, previews, reopen on Resolved, 409 on Closed
- book edge cases: in production, never paid, fully paid, below threshold, no sales, plus the payout-date maths
- AI decoupling: the triage service is mocked with `jest.unstable_mockModule` to throw and to hang
- SSE: headers, the `ready` event, `publishToUser` delivery, and cleanup on disconnect

To check the tests can fail, the core guarantees were broken one at a time and each break failed at least one test:
- removing the ownership scope
- removing the admin role gate
- letting previews include internal notes
- awaiting the AI call during ticket creation
- allowing replies on Closed tickets
- dropping "unresolved first" from the queue sort
- always flagging admin edits as overrides
- removing `overwriteImmutable` from the seed

Admin suites:
- `adminTickets`: a fixed 9-ticket dataset with known ages and priorities asserts the exact queue order, every filter and combination, the 400 validation of each filter, the SLA/overdue maths, full detail, override tracking, assignment, notes, replies and stats.
- `sse`: live delivery of admin events to authors, with internal notes absent.
- `seed`: the dataset is seeded exactly, and a re-run after simulated drift restores counts, statuses, passwords and ticket ages.

## Data model

Defined in `server/src/models/`. Shared enums (statuses, categories, priorities) live in `models/enums.js`, so validators and AI prompts can only use values the schema accepts.

| Collection | Purpose | Key points |
|---|---|---|
| `users` | Authors and admins in one collection, split by `role` | `email` unique (lowercased). `passwordHash` is `select: false` and stripped from JSON. `authorCode` (`AUTH001`) links back to the source data. |
| `books` | Catalogue, one doc per book | `authorId → users`, natural `bookId` (`BK001`) and `isbn` unique. In-production books keep `mrp`, `royaltyPerCopy`, `publicationDate` and `printPartner` as `null`. Money is whole rupees. |
| `tickets` | Support queries | `ticketNumber` `BL-0001` comes from an atomic `counters` sequence. `bookId: null` means "General / Account Level". Final `category`/`priority` sit next to `aiCategory`/`aiPriority` + `*Overridden` flags (audit trail and an AI accuracy signal). `aiStatus` is `pending/done/failed`, with `aiError`. Attachments are metadata only. |
| `ticketmessages` | Thread after the original query | `senderRole`, `isInternalNote`, `wasAiDrafted`. A validation hook stops authors from posting notes. |
| `aidrafts` | One cached AI draft per ticket | `contextHash` fingerprints the inputs, so a draft is reused until the ticket changes. Also stores `model` and `tokenUsage` for cost tracking. |
| `counters` | Named sequences | `$inc` in one atomic op; no "count + 1" race. |

Design choices:
- **Urgency sorting**: priority labels don't sort meaningfully, so each ticket stores two derived fields: `priorityRank` (Critical 0 … Low 3) and `isUnresolved` (status is Open / In Progress). Hooks keep both in sync on `save()` and on query updates. `Ticket.syncDerivedFields()`, run by the seed, backfills older documents. The queue index `{ isUnresolved: -1, priorityRank: 1, createdAt: 1 }` serves "unresolved first, most urgent, then oldest" straight from the index. `{ status, priorityRank, createdAt }` serves the same order when the queue is filtered by status. Unclassified tickets rank with Medium.
- **Internal notes fail closed**: threads are read through `TicketMessage.findThread(ticketId, { viewerRole })`. The role is mandatory, and non-admins get `isInternalNote: false` applied in the query itself. Calling it without a role throws instead of leaking notes.
- **Other indexes**: `{ authorId, createdAt }` (My Tickets), `{ category, createdAt }`, `{ assignedTo, status }`, `{ aiStatus, createdAt }` (retry failed classifications), `{ ticketId, createdAt }` on messages.

## Seeding

`npm run seed` (in `server/`) is idempotent and never drops collections:
- Users are upserted by email and books by `bookId`, straight from `seed/data.json` (the provided dataset, unchanged). Demo passwords are reset on every run so the documented credentials always work.
- Seven demo tickets (`seed/sampleTickets.js`) are upserted by fixed numbers `BL-0001..BL-0007`, and their threads are rebuilt. They cover every category and status and are grounded in real seeded data, for example Ananya's ₹2,546 that was never paid and Sneha's book stuck in cover design. They are seeded as hand-triaged (`category`/`priority` set) with `aiStatus: 'pending'`.
- The ticket counter is raised to at least 7, so app-created tickets continue from `BL-0008`.
- The seed checks the dataset's royalty arithmetic (copies × rate = earned; earned − paid = pending) and warns on mismatches. The provided data passes.
- Ticket ages are relative to the time of the run, so the demo queue always looks current. They are chosen to show a realistic mix: Ananya's Critical (72h) and Vikram's High (120h) are overdue, and the others are within target. Re-running resets ages too: `overwriteImmutable` is needed because Mongoose otherwise drops `createdAt` from updates. Without it, earlier versions silently kept the first run's dates, and `tests/seed.test.js` now guards against that.
- The seed also backfills derived ticket fields (`Ticket.syncDerivedFields()`) and syncs indexes, so it doubles as the migration step after a schema change.
- `seedDatabase()` is exported for tests. The CLI runs only when the file is executed directly.

## AI integration

Full design, cost maths and failure matrix: **[server/docs/AI_DESIGN.md](server/docs/AI_DESIGN.md)**.

- **Classification**: one JSON-mode `gpt-4o-mini` call per new ticket, at temperature 0. It sees a priority rubric and only the subject, description and a small numeric account context; no knowledge base. The output is Zod-validated. The call runs in the background after the 201 and then pushes a `ticket.classified` SSE event.
- **Graceful degradation**: if the AI is down or returns junk, a weighted-keyword classifier sets category/priority. The ticket is marked `aiStatus: failed`, `classificationSource: rules`. Admin overrides are never overwritten.
- **Draft reply**: `POST /admin/tickets/:id/draft[?regenerate=true]`.
  - **Prompt**: the category's 1–2 KB sections, one matching example, facts about the referenced book only (with derived payout-date and overdue lines), and the last 3 thread entries.
  - **Cache**: drafts are cached per ticket by context hash.
  - **Guard rails**: a ₹-amount check and sign-off enforcement.
  - **On failure**: 503 with a category template and the last good draft.
- **Resilience**: one client with a 15s timeout, 2 retries (exponential backoff, Retry-After) and a circuit breaker (3 failures → 60s pause). `/health` reports `ai: degraded` while the breaker is open.
- **Cost**: about $0.0005 per ticket at list prices, measured live. Retrieval sends about 53% fewer draft input tokens than the full KB would. Every call is logged; see `GET /admin/ai/usage`.
- **Concurrency**: classification takes an atomic lease (`aiClaimedAt`), so restarts or several instances never classify, and pay for, the same ticket twice.
- **Source of truth**: `ai/knowledgeBase.js` also exports the policy numbers (₹1,000 threshold, 45-day window, production stages) that `services/bookInsights.js` uses, so the API and the AI can't disagree.

## Real-time

Server-Sent Events. Events catalogue, payloads, client usage and the scaling limitation are in the **[README](README.md#real-time-updates-server-sent-events)**.

- `services/eventHub.js`: an in-memory hub with channels `user:<authorId>` and `admins`.
  - Every event carries an SSE id, `<bootId>.<seq>`; reconnects replay from a 10-minute / 100-event buffer using `Last-Event-ID`.
  - `ready.resync` tells the client to refetch when the gap can't be filled.
  - It also sends 25 s heartbeats, cleans up on disconnect, caps each user at 5 streams, and `closeAll()` on shutdown.
- `services/ticketEvents.js`: the single place that builds payloads. Services call `ticketCreated`, `ticketClassified`, `authorReplied`, `adminReplied` and `ticketUpdated`; they never publish raw documents.
  - Author payloads are whitelisted (ticket id/number/status/updatedAt, plus the author-view message).
  - Publishing an internal note to an author throws.
- **Limitation**: single instance only. Horizontal scaling needs Redis pub/sub behind `publish()` / `deliverLocal()`, and Redis Streams for the replay buffer.

## Frontend (`client/`)

Next.js 16 App Router, Tailwind v4, `lucide-react` icons and `sonner` toasts. `cacheComponents` is on.

```
client/
├── app/                  routes: thin server page.tsx (metadata, Suspense) + a client *-view.tsx
│   ├── login/            sign-in with a demo-credentials panel
│   ├── author/           dashboard, books, tickets, tickets/new, tickets/[id]
│   └── admin/            guarded placeholder (console is the next step)
├── components/
│   ├── ui/               button, card, badge, field, skeleton, empty/error/loading states
│   ├── layout/           AppShell: sidebar on desktop, top bar + menu on mobile, skip link
│   ├── auth/             RoleGate
│   ├── author/           AuthorFrame, AuthorLiveProvider (one SSE stream per tab)
│   ├── books/, tickets/  domain components (production stepper, payout note, status badge, dropzone)
└── lib/                  api.ts, auth.tsx, useSSE.ts, useResource.ts, types.ts, format.ts
```

Decisions:
- **Data is fetched in the browser.** The session is an httpOnly cookie owned by the API's origin; in production that's a different site, so the Next server can't read it. Pages are therefore client views fetching through `lib/api.ts`.
  - Every request sends credentials.
  - Every failure becomes one `ApiError` shape (code, message, field details, request id), including network errors.
  - Any 401 signs the user out everywhere.
- **Route protection** is a client `RoleGate` in the `/author` and `/admin` layouts.
  - It redirects anonymous users to `/login?next=…` and sends the wrong role to its own portal.
  - The API enforces auth regardless; the gate is for UX.
  - `next` only accepts same-area paths, so it can't be used as an open redirect.
- **Cache Components constraints:**
  - `useParams`, `useSearchParams` and `usePathname` (under dynamic routes) need `<Suspense>`, so layouts and URL-driven pages wrap their client views.
  - Pages inside the gate export `instant = false`. Navigation waits on the client session check by design, and the opt-out must sit on each page segment.
  - Visited pages are kept mounted but hidden (React Activity), so `useResource` refetches when a page is shown again, and the new-ticket form resets itself after submit.
- **Live updates.** `useSSE` wraps `EventSource` with credentials.
  - Handlers go through `useEffectEvent`, so re-renders never reconnect.
  - It tracks the last event id and reopens with `?lastEventId=` (exponential backoff) when the browser gives up, and reacts to `ready.resync`.
  - The author layout owns the single stream and toasts; pages subscribe with `useAuthorLive`. The ticket page appends replies in place, and lists refetch silently.
- **Author-safe UI:** `lib/types.ts` has no priority, AI or internal-note fields at all, and the API never sends them to authors.
- **Edge cases:**
  - Books in production show a 9-stage stepper and "—" (with a screen-reader explanation) instead of zero figures.
  - Published books get a plain-language payout note: first payout, below the ₹1,000 minimum, fully paid, or no sales yet. It includes the next quarterly payout deadline from the API.
- **Accessibility:**
  - Labelled fields with `aria-describedby` and `aria-invalid`; focus moves to the first invalid field.
  - Status badges show colour plus icon plus text.
  - The thread is a `role="log"` live region.
  - Progress bars have ARIA values.
  - Skip link, visible focus ring, and reduced-motion support.
