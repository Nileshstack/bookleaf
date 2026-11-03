# Architecture (draft)

> Status: foundation only. Sections marked **(planned)** describe the intended design for work not yet built.

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

`requestId → helmet → cors → json body (100kb) → morgan → /api/v1 router → [health] → apiLimiter → feature routes → notFound → errorHandler`

- `/api/v1/health` sits before the rate limiter so uptime probes are never throttled. It returns 503 if Mongo is down. A missing OpenAI key is reported as `ai: "disabled"`, not as a failure.
- Express 5 forwards rejected promises from async handlers to the error middleware, so there is no `asyncHandler` wrapper boilerplate.

## Error contract

Every error leaves the API in one shape:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "requestId": "..." } }
```

- Throw `AppError` (or its factories, such as `AppError.notFound('Ticket')`) for expected failures.
- `errorHandler` maps Zod, Mongoose (validation, cast, duplicate key), JWT and body-parser errors to proper 4xx codes.
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
- **Urgency sorting**: priority labels don't sort meaningfully, so each ticket stores a derived `priorityRank` (Critical 0 … Low 3). Hooks keep it in sync on `save()` and on query updates. The queue index is `{ status, priorityRank, createdAt }`, which gives "most urgent, then oldest" straight from the index. Unclassified tickets rank with Medium.
- **Internal notes fail closed**: threads are read through `TicketMessage.findThread(ticketId, { viewerRole })`. The role is mandatory, and non-admins get `isInternalNote: false` applied in the query itself. Calling it without a role throws instead of leaking notes.
- **Other indexes**: `{ authorId, createdAt }` (My Tickets), `{ category, createdAt }`, `{ assignedTo, status }`, `{ aiStatus, createdAt }` (retry failed classifications), `{ ticketId, createdAt }` on messages.

## Seeding

`npm run seed` (in `server/`) is idempotent and never drops collections:
- Users are upserted by email and books by `bookId`, straight from `seed/data.json` (the provided dataset, unchanged). Demo passwords are reset on every run so the documented credentials always work.
- Seven demo tickets (`seed/sampleTickets.js`) are upserted by fixed numbers `BL-0001..BL-0007`, and their threads are rebuilt. They cover every category and status and are grounded in real seeded data, for example Ananya's ₹2,546 that was never paid and Sneha's book stuck in cover design. They are seeded as hand-triaged (`category`/`priority` set) with `aiStatus: 'pending'`.
- The ticket counter is raised to at least 7, so app-created tickets continue from `BL-0008`.
- The seed checks the dataset's royalty arithmetic (copies × rate = earned; earned − paid = pending) and warns on mismatches. The provided data passes.

## (planned) AI integration

- **Classification + priority**: one JSON-mode call per new ticket. It runs *after* the ticket is saved, so an AI outage never blocks ticket creation. On failure the ticket keeps `category: "General Inquiry"` / `priority: "Medium"` and is flagged `ai.status = failed` for manual triage.
- **Draft response**: generated when an admin opens a ticket. The draft is cached on the ticket so reopening it costs nothing. The admin can always edit, or write from scratch if the AI is unavailable.
- **Cost control**: the knowledge base is split into sections, and only the section for the ticket's category plus the tone guidelines go into the prompt. The prompt also gets only the relevant book's facts (not the whole catalogue) and the latest message, not the full history. Inputs are length-capped and outputs use `max_tokens`. The model is `gpt-4o-mini`.

## (planned) Real-time

Server-Sent Events, because updates flow one way (server to browser) and SSE works over plain HTTP with automatic reconnect. An in-process event bus publishes ticket events to per-author and admin channels. Limitation: this works for a single API instance. Scaling out would need Redis pub/sub behind the same bus interface.
