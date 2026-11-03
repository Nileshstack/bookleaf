# BookLeaf Author Support & Communication Portal

A support portal for BookLeaf Publishing. Authors raise tickets about royalties, ISBNs, printing and distribution, and see replies live. The operations team works an AI-triaged queue and replies from AI drafts grounded in BookLeaf's knowledge base and each author's real book data.

- **Backend** (`server/`): Node.js, Express 5, MongoDB/Mongoose, OpenAI `gpt-4o-mini`, Server-Sent Events
- **Frontend** (`client/`): Next.js App Router + Tailwind *(in progress)*

Further reading:
- [ARCHITECTURE.md](ARCHITECTURE.md): structure, data model, auth, endpoints
- [server/docs/AI_DESIGN.md](server/docs/AI_DESIGN.md): prompts, cost, failure handling

## Quick start

Prerequisites: Node.js ≥ 20.6 and a MongoDB connection string (local or Atlas). An OpenAI API key is optional; without one, triage falls back to rules and drafts fall back to templates.

```bash
cp server/.env.example server/.env    # fill in MONGODB_URI, JWT_SECRET (32+ chars), optionally OPENAI_API_KEY
npm install --prefix server
npm run seed --prefix server          # idempotent: 10 authors, 18 books, 7 demo tickets, 1 admin
npm run dev --prefix server           # http://localhost:5000/api/v1/health
```

```bash
cp client/.env.example client/.env.local
npm install --prefix client
npm run dev --prefix client           # http://localhost:3000
```

Run the server tests (no database or OpenAI needed; uses an in-memory MongoDB and a mocked SDK):

```bash
npm test --prefix server
```

## Demo credentials

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@bookleaf.com` | `Admin@123` | |
| Author | `priya.sharma@email.com` | `Author@123` | 2 books, pending royalty |
| Author | `ananya.reddy@email.com` | `Author@123` | Royalty never paid (Critical ticket) |
| Author | `sneha.kulkarni@email.com` | `Author@123` | Includes a book still in Cover Design |
| Author | `kavita.deshmukh@email.com` | `Author@123` | Book in Typesetting; pending below ₹1,000 |

All 10 authors in the dataset use `Author@123`. `npm run seed` prints the full table.

## Real-time updates (Server-Sent Events)

Updates only flow server → browser (a new reply, a status change, a new ticket in the queue), so the portal uses SSE rather than WebSockets. SSE runs over plain HTTP, passes through proxies, and the browser's `EventSource` reconnects automatically.

### Streams

| Endpoint | Who | Channel | Events |
|---|---|---|---|
| `GET /api/v1/tickets/stream` | author | `user:<authorId>` | `admin_reply`, `status_changed` |
| `GET /api/v1/admin/tickets/stream` | admin | `admins` | `new_ticket`, `ticket_classified`, `author_reply`, `ticket_updated` |

Every stream also gets a `ready` event on connect: `{ connectedAt, replayed, resync }`.

| Event | Emitted when | Payload |
|---|---|---|
| `admin_reply` | An admin replies (not an internal note) | `{ ticket: { ticketId, ticketNumber, status, updatedAt }, message: { senderRole, senderName, body, createdAt } }` |
| `status_changed` | Status changes (admin edit, or a reply that moves Open → In Progress) | `{ ticket, previousStatus }` |
| `new_ticket` | An author creates a ticket | `{ ticket, authorName, createdAt }` |
| `ticket_classified` | AI or rule-based triage finishes | `{ ticket, aiCategory, aiPriority, aiReasoning, aiConfidence }` |
| `author_reply` | An author follows up | `{ ticket, preview, reopened, authorName }` |
| `ticket_updated` | Admin edit, assignment, internal note, or reply | `{ ticket, changes: [...], previousStatus, actorName }` |

### Guarantees
- **Authors only receive their own tickets' events.** The author stream subscribes to exactly one channel, the author's own.
- **No internal leakage.** All payloads are built in `server/src/services/ticketEvents.js`.
  - Author payloads come from a field whitelist, so priority, AI fields, assignee and `wasAiDrafted` can't be included.
  - Internal notes never produce an author event, and publishing one to an author channel throws.
  - Tests read real streams and assert all of this.
- **Auth uses the httpOnly cookie.** `EventSource` can't set headers, so it relies on the session cookie (a Bearer header also works for tools).
- **Heartbeats** go out every 25 s (`: ping` comments), so proxies don't close idle streams.
- **Cleanup** on disconnect.
- **Stream cap:** 5 streams per user (the oldest is closed).
- **Shutdown:** all streams are closed before the server stops.
- **Reconnect without losing events.** Every event has an id.
  - On reconnect, `EventSource` sends `Last-Event-ID` and the server replays what that channel missed from a 10-minute / 100-event buffer, then sends `ready`.
  - If the gap can't be filled (the server restarted, or the buffer expired), `ready.resync` is `true` and the client should refetch.

### Client usage

```js
const es = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/tickets/stream`, { withCredentials: true });

es.addEventListener('ready', (e) => {
  if (JSON.parse(e.data).resync) refetchTickets();   // missed events we can't replay
});
es.addEventListener('admin_reply', (e) => {
  const { ticket, message } = JSON.parse(e.data);
  appendMessage(ticket.ticketNumber, message);
});
es.addEventListener('status_changed', (e) => updateStatus(JSON.parse(e.data).ticket));
```

Cross-origin requirements:
- The API allows the client origin with `credentials: true` (`CLIENT_URL`).
- In production the auth cookie is `SameSite=None; Secure`, because the client and API are on different sites.

### Limitation: one API instance

The event hub (`server/src/services/eventHub.js`) is **in-memory**. Subscribers, the replay buffer and the stream registry all live in one Node process. That is fine for a single instance, which is how this is deployed. **With more than one API instance behind a load balancer, an event published on instance A never reaches a client connected to instance B.**

Planned fix for horizontal scaling, which needs no change to the services that emit events:
1. **Redis pub/sub for fan-out.** `eventHub.publish(channel, …)` would `PUBLISH` to Redis. Every instance subscribes and delivers to its own local clients (the existing `deliverLocal`).
2. **Redis Streams for replay.** The per-channel history moves to `XADD` / `XRANGE` with a max length, so `Last-Event-ID` replay works whichever instance the client reconnects to. Ids would then come from Redis instead of `<bootId>.<seq>`.
3. **No sticky sessions needed** once both are in place.

The same applies to the other in-process pieces (the AI circuit breaker and background classification). See ARCHITECTURE.md.
