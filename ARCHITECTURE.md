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
├── seed/         Sample dataset + seed script.
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

## (planned) Data model

- **User**: `email`, `passwordHash`, `role: author | admin`, `authorId` (for authors).
- **Author / Book**: seeded from `seed/data/bookleaf_sample_data.json`, keeping the natural ids (`AUTH001`, `BK001`). Nullable fields stay null; in-production books have no MRP or royalty.
- **Ticket**: `author`, `book` (optional, for "General / Account Level"), `subject`, `description`, `status`, `category` and `priority`, each with an `aiSuggested` value and an `overriddenBy` admin field, `assignee`, and `ai` metadata (model, latency, failure reason).
- **Message**: one thread per ticket, typed `author_message | admin_response | internal_note`. Internal notes are filtered out server-side for authors.

## (planned) AI integration

- **Classification + priority**: one JSON-mode call per new ticket. It runs *after* the ticket is saved, so an AI outage never blocks ticket creation. On failure the ticket keeps `category: "General Inquiry"` / `priority: "Medium"` and is flagged `ai.status = failed` for manual triage.
- **Draft response**: generated when an admin opens a ticket. The draft is cached on the ticket so reopening it costs nothing. The admin can always edit, or write from scratch if the AI is unavailable.
- **Cost control**: the knowledge base is split into sections, and only the section for the ticket's category plus the tone guidelines go into the prompt. The prompt also gets only the relevant book's facts (not the whole catalogue) and the latest message, not the full history. Inputs are length-capped and outputs use `max_tokens`. The model is `gpt-4o-mini`.

## (planned) Real-time

Server-Sent Events, because updates flow one way (server to browser) and SSE works over plain HTTP with automatic reconnect. An in-process event bus publishes ticket events to per-author and admin channels. Limitation: this works for a single API instance. Scaling out would need Redis pub/sub behind the same bus interface.
