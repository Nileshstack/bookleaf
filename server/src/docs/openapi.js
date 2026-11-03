/**
 * OpenAPI 3.0 description of the BookLeaf API, served at /api/docs (Swagger
 * UI) and /api/docs/openapi.json. tests/openapi.test.js keeps it in sync
 * with the route files in both directions, so an endpoint can't be added or
 * removed without updating this file.
 */

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, example) => ({ 'application/json': { schema, ...(example && { example }) } });
const envelope = (data, meta) => ({
  type: 'object',
  required: ['success', 'data'],
  properties: { success: { type: 'boolean', example: true }, data, ...(meta && { meta: ref('PageMeta') }) },
});
const ok = (description, data, { status = 200, meta = false } = {}) => ({
  [status]: { description, content: json(envelope(data, meta)) },
});
const err = (...names) => Object.fromEntries(names.map((n) => [ERROR_STATUS[n], { $ref: `#/components/responses/${n}` }]));

const ERROR_STATUS = {
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  ValidationError: 422,
  RateLimited: 429,
  ServiceUnavailable: 503,
};

const ticketRefParam = {
  name: 'ticketId',
  in: 'path',
  required: true,
  description: 'Ticket Mongo id or ticket number (e.g. `BL-0005`).',
  schema: { type: 'string', example: 'BL-0005' },
};
const bookRefParam = {
  name: 'bookId',
  in: 'path',
  required: true,
  description: 'Book Mongo id or book code (e.g. `BK001`).',
  schema: { type: 'string', example: 'BK001' },
};
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const csv = (description, values) => ({
  type: 'string',
  description: `${description} One value, a comma-separated list, or the parameter repeated. Allowed: ${values.join(', ')}.`,
});

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const CATEGORIES = [
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const sse = (events) => ({
  200: {
    description: `Server-Sent Events stream. Sends \`retry\`, a \`ready\` event (\`{ connectedAt, replayed, resync }\`), heartbeat comments every 25s, then: ${events}. Every event has an \`id\`; reconnecting with \`Last-Event-ID\` (or \`?lastEventId=\`) replays what the channel missed in the last 10 minutes.`,
    content: { 'text/event-stream': { schema: { type: 'string' }, example: 'id: mw0crfwc.12\nevent: ready\ndata: {"connectedAt":"2026-11-03T07:24:01Z","replayed":0,"resync":false}\n\n' } },
  },
});

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'BookLeaf Author Support API',
    version: '1.0.0',
    description: [
      'REST API for the BookLeaf Author Support & Communication Portal.',
      '',
      '**Authentication.** `POST /auth/login` sets an httpOnly `bl_token` cookie (used by the web app) and also returns the JWT in the body, so tools can send `Authorization: Bearer <token>`. Every endpoint except health, login and logout requires one of the two.',
      '',
      '**Roles.** Author endpoints only ever return the caller\'s own data. Another author\'s ticket or book is a `404`, indistinguishable from one that does not exist. `/admin/*` and `/users` are admin-only (`403` for authors).',
      '',
      '**Errors** always use the shape `{ success: false, error: { code, message, details[], requestId } }`. Validation failures list `details[].field`: `422` for a bad body, `400` for bad URL params or query. Some errors add machine-readable fields, such as `fallback` on `AI_UNAVAILABLE`.',
      '',
      '**Demo accounts.** `admin@bookleaf.com` / `Admin@123`; any seeded author (e.g. `ananya.reddy@email.com`) / `Author@123`.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1', description: 'This server' }],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Author: Books', description: 'The signed-in author\'s own books.' },
    { name: 'Author: Tickets', description: 'The signed-in author\'s own tickets.' },
    { name: 'Admin: Queue', description: 'Ticket queue and ticket management.' },
    { name: 'Admin: AI', description: 'AI drafts, re-classification and usage.' },
    { name: 'Admin: Reporting' },
    { name: 'Realtime', description: 'Server-Sent Event streams.' },
  ],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness and dependency status',
        security: [],
        responses: {
          ...ok('Healthy', ref('Health')),
          503: { description: 'Database unreachable (body has the same shape, with `success: false`).' },
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        description: 'Sets the httpOnly `bl_token` cookie and returns the user and token. Rate-limited to 10 failed attempts per 15 minutes per IP.',
        security: [],
        requestBody: { required: true, content: json(ref('LoginInput'), { email: 'ananya.reddy@email.com', password: 'Author@123' }) },
        responses: {
          ...ok('Signed in', { type: 'object', properties: { user: ref('User'), token: { type: 'string' } } }),
          401: { $ref: '#/components/responses/InvalidCredentials' },
          ...err('BadRequest', 'ValidationError', 'RateLimited'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Clear the session cookie',
        description: 'Public, so an expired session can still clear its cookie.',
        security: [],
        responses: ok('Signed out', { type: 'object', properties: { loggedOut: { type: 'boolean' } } }),
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'The signed-in user',
        responses: { ...ok('Current user', { type: 'object', properties: { user: ref('User') } }), ...err('Unauthorized') },
      },
    },

    '/books': {
      get: {
        tags: ['Author: Books'],
        summary: 'My books, with royalty breakdown and production stage',
        responses: { ...ok('The author\'s books', { type: 'array', items: ref('Book') }), ...err('Unauthorized', 'Forbidden') },
      },
    },
    '/books/{bookId}': {
      get: {
        tags: ['Author: Books'],
        summary: 'One of my books',
        parameters: [bookRefParam],
        responses: { ...ok('Book', ref('Book')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound') },
      },
    },

    '/tickets': {
      get: {
        tags: ['Author: Tickets'],
        summary: 'My tickets, newest first, with last-message preview',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: STATUSES } },
          { name: 'category', in: 'query', schema: { type: 'string', enum: CATEGORIES } },
          ...pageParams,
        ],
        responses: {
          ...ok('Tickets', { type: 'array', items: ref('AuthorTicketListItem') }, { meta: true }),
          ...err('BadRequest', 'Unauthorized', 'Forbidden'),
        },
      },
      post: {
        tags: ['Author: Tickets'],
        summary: 'Raise a ticket',
        description:
          'Only these fields are accepted; anything else (status, priority, authorId...) is ignored. `bookId` must be one of the author\'s books, or omitted/null/"" for General / Account Level. The ticket is saved and returned immediately; AI classification runs afterwards in the background and never blocks creation. Limited to 20 tickets per author per hour.',
        requestBody: {
          required: true,
          content: json(ref('NewTicketInput'), {
            bookId: 'BK005',
            subject: 'Never received any royalty',
            description: 'My book has been live since July 2024 but I have not received a single royalty payment.',
            attachments: [{ fileName: 'statement.pdf', sizeBytes: 120000, mimeType: 'application/pdf' }],
          }),
        },
        responses: {
          ...ok('Created. The `Location` header points to the ticket.', ref('AuthorTicketDetail'), { status: 201 }),
          ...err('Unauthorized', 'Forbidden', 'ValidationError', 'RateLimited'),
        },
      },
    },
    '/tickets/stream': {
      get: {
        tags: ['Realtime', 'Author: Tickets'],
        summary: 'Live updates for my tickets (SSE)',
        description: 'Authenticates with the cookie (EventSource `withCredentials`) or Bearer. Only the author\'s own ticket events.',
        responses: {
          ...sse('`admin_reply` `{ ticket, message }`, `status_changed` `{ ticket, previousStatus }`. Payloads never contain priority, AI fields or internal notes'),
          ...err('Unauthorized', 'Forbidden'),
        },
      },
    },
    '/tickets/{ticketId}': {
      get: {
        tags: ['Author: Tickets'],
        summary: 'One of my tickets with its conversation',
        description: 'Internal notes and AI metadata are never included.',
        parameters: [ticketRefParam],
        responses: { ...ok('Ticket', ref('AuthorTicketDetail')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound') },
      },
    },
    '/tickets/{ticketId}/messages': {
      post: {
        tags: ['Author: Tickets'],
        summary: 'Reply on my ticket',
        description: 'A reply to a Resolved ticket reopens it (status → Open). Closed tickets reject replies with `409 TICKET_CLOSED`.',
        parameters: [ticketRefParam],
        requestBody: { required: true, content: json(ref('MessageInput'), { body: 'Any update on this?' }) },
        responses: {
          ...ok(
            'Reply stored',
            {
              type: 'object',
              properties: {
                message: ref('Message'),
                ticket: { type: 'object', properties: { ticketNumber: { type: 'string' }, status: { type: 'string', enum: STATUSES }, reopened: { type: 'boolean' } } },
              },
            },
            { status: 201 },
          ),
          ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'ValidationError'),
        },
      },
    },

    '/users': {
      get: {
        tags: ['Admin: Reporting'],
        summary: 'List users (admin)',
        parameters: [{ name: 'role', in: 'query', schema: { type: 'string', enum: ['author', 'admin'] } }, ...pageParams],
        responses: { ...ok('Users', { type: 'array', items: ref('User') }, { meta: true }), ...err('BadRequest', 'Unauthorized', 'Forbidden') },
      },
    },

    '/admin/stats': {
      get: {
        tags: ['Admin: Reporting'],
        summary: 'Queue counts, open-ticket age, AI override and draft-adoption rates',
        responses: { ...ok('Stats', ref('AdminStats')), ...err('Unauthorized', 'Forbidden') },
      },
    },
    '/admin/tickets': {
      get: {
        tags: ['Admin: Queue'],
        summary: 'Ticket queue with filters',
        description: 'Default sort `queue`: unresolved first, then most urgent, then oldest. Each item includes `ageHours`, `slaHours`, `dueAt` and `isOverdue` (Critical 24h, High 48h, Medium 96h, Low 168h).',
        parameters: [
          { name: 'status', in: 'query', schema: csv('Status filter.', STATUSES) },
          { name: 'category', in: 'query', schema: csv('Category filter.', CATEGORIES) },
          { name: 'priority', in: 'query', schema: csv('Priority filter.', PRIORITIES) },
          { name: 'aiStatus', in: 'query', schema: csv('AI classification state.', ['pending', 'done', 'failed']) },
          { name: 'authorId', in: 'query', schema: { type: 'string', description: 'Mongo id or author code (AUTH001).' } },
          { name: 'assignedTo', in: 'query', schema: { type: 'string', description: '`me`, `unassigned`, or an admin id.' } },
          { name: 'from', in: 'query', schema: { type: 'string', description: 'YYYY-MM-DD or ISO timestamp (createdAt ≥).' } },
          { name: 'to', in: 'query', schema: { type: 'string', description: 'YYYY-MM-DD (inclusive, whole UTC day) or ISO timestamp.' } },
          { name: 'overdue', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100, description: 'Literal search over subject, description, ticket number, author name/email and book title.' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['queue', 'newest', 'oldest', 'updated'], default: 'queue' } },
          ...pageParams,
        ],
        responses: { ...ok('Queue page', { type: 'array', items: ref('QueueItem') }, { meta: true }), ...err('BadRequest', 'Unauthorized', 'Forbidden') },
      },
    },
    '/admin/tickets/stream': {
      get: {
        tags: ['Realtime', 'Admin: Queue'],
        summary: 'Live queue updates (SSE)',
        responses: {
          ...sse('`new_ticket`, `ticket_classified`, `author_reply`, `ticket_updated` (with `changes[]`)'),
          ...err('Unauthorized', 'Forbidden'),
        },
      },
    },
    '/admin/tickets/{ticketId}': {
      get: {
        tags: ['Admin: Queue'],
        summary: 'Full ticket detail',
        description: 'Thread including internal notes, author profile with royalty totals, the referenced book with insights, and the author\'s other open tickets.',
        parameters: [ticketRefParam],
        responses: { ...ok('Ticket', ref('AdminTicketDetail')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound') },
      },
      patch: {
        tags: ['Admin: Queue'],
        summary: 'Update status, category, priority or assignee',
        description: 'Strict body: unknown keys are a 422. A category/priority that differs from the AI suggestion is recorded as an override; the AI\'s original values are kept.',
        parameters: [ticketRefParam],
        requestBody: { required: true, content: json(ref('TicketUpdateInput'), { category: 'Royalty & Payments', priority: 'High' }) },
        responses: { ...ok('Updated ticket detail', ref('AdminTicketDetail')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'ValidationError') },
      },
    },
    '/admin/tickets/{ticketId}/assign-to-me': {
      post: {
        tags: ['Admin: Queue'],
        summary: 'Assign the ticket to the caller',
        parameters: [ticketRefParam],
        responses: { ...ok('Updated ticket detail (+ previousAssigneeId)', ref('AdminTicketDetail')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound') },
      },
    },
    '/admin/tickets/{ticketId}/notes': {
      post: {
        tags: ['Admin: Queue'],
        summary: 'Add an internal note (never visible to the author)',
        parameters: [ticketRefParam],
        requestBody: { required: true, content: json(ref('MessageInput'), { body: 'Checked with finance: payout batch failed in Q3.' }) },
        responses: { ...ok('Note', ref('AdminMessage'), { status: 201 }), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'ValidationError') },
      },
    },
    '/admin/tickets/{ticketId}/reply': {
      post: {
        tags: ['Admin: Queue'],
        summary: 'Reply to the author',
        description:
          'Visible to the author and pushed live. Without `status`, an Open ticket moves to In Progress; an unassigned ticket is assigned to the replier. A Closed ticket needs an explicit `status` to reopen (`409` otherwise).',
        parameters: [ticketRefParam],
        requestBody: { required: true, content: json(ref('AdminReplyInput'), { body: 'Hi Ananya, ...', wasAiDrafted: true, status: 'In Progress' }) },
        responses: {
          ...ok(
            'Reply stored',
            {
              type: 'object',
              properties: {
                message: ref('AdminMessage'),
                ticket: { type: 'object', properties: { ticketNumber: { type: 'string' }, status: { type: 'string', enum: STATUSES }, assignedTo: { type: 'string' } } },
              },
            },
            { status: 201 },
          ),
          ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'ValidationError'),
        },
      },
    },
    '/admin/tickets/{ticketId}/draft': {
      post: {
        tags: ['Admin: AI'],
        summary: 'Get an AI draft reply (cached)',
        description:
          'Built from the knowledge-base sections for the ticket\'s category, the referenced book\'s real data and the last 3 messages. Cached per ticket until the context changes (new message, new day, prompt/KB version); `regenerate=true` forces a new one. If the AI is unavailable, returns `503 AI_UNAVAILABLE` with a category template and the last good draft.',
        parameters: [ticketRefParam, { name: 'regenerate', in: 'query', schema: { type: 'string', enum: ['true', 'false'], default: 'false' } }],
        responses: { ...ok('Draft', ref('AiDraft')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'RateLimited', 'ServiceUnavailable') },
      },
    },
    '/admin/tickets/{ticketId}/classify': {
      post: {
        tags: ['Admin: AI'],
        summary: 'Re-run AI classification now',
        description: 'Falls back to keyword rules if the AI is unavailable. Never overwrites an admin override. `409` if a classification is already running.',
        parameters: [ticketRefParam],
        responses: { ...ok('Updated ticket detail', ref('AdminTicketDetail')), ...err('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'RateLimited') },
      },
    },
    '/admin/ai/usage': {
      get: {
        tags: ['Admin: AI'],
        summary: 'AI usage, cost and reliability',
        parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 90, default: 30 } }],
        responses: { ...ok('Usage summary', ref('AiUsage')), ...err('BadRequest', 'Unauthorized', 'Forbidden') },
      },
    },
  },

  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'bl_token', description: 'httpOnly session cookie set by /auth/login.' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The `token` returned by /auth/login.' },
    },
    responses: {
      BadRequest: errorResponse('Malformed JSON, or invalid path/query parameters.', 'VALIDATION_ERROR', 'Invalid query parameters', [{ field: 'status.0', message: 'Invalid option' }]),
      Unauthorized: errorResponse('Missing, invalid or expired session.', 'UNAUTHORIZED', 'Authentication required'),
      InvalidCredentials: errorResponse('Wrong email or password (same response for unknown emails).', 'INVALID_CREDENTIALS', 'Invalid email or password'),
      Forbidden: errorResponse('Signed in, but this role may not use this endpoint.', 'FORBIDDEN', 'You do not have permission to perform this action'),
      NotFound: errorResponse('Does not exist, or belongs to another author.', 'NOT_FOUND', 'Ticket not found'),
      Conflict: errorResponse('State conflict, e.g. replying to a closed ticket.', 'TICKET_CLOSED', 'This ticket is closed and can no longer receive replies.'),
      ValidationError: errorResponse('Well-formed body with invalid values.', 'VALIDATION_ERROR', 'Validation failed', [{ field: 'subject', message: 'Subject must be at least 5 characters' }]),
      RateLimited: errorResponse('Too many requests.', 'RATE_LIMITED', 'Too many requests, please slow down and try again shortly'),
      ServiceUnavailable: {
        description: 'AI unavailable. Includes a policy-safe template and the last good draft so the admin can reply manually.',
        content: json(ref('Error'), {
          success: false,
          error: {
            code: 'AI_UNAVAILABLE',
            message: 'AI drafting is unavailable right now. Use the template below or write the reply manually.',
            details: [],
            reason: 'UPSTREAM_ERROR',
            fallback: { template: 'Hi Ananya,\n\nThank you for raising this...\n\nWarm regards,\nTeam BookLeaf', staleDraft: null },
            requestId: '5d0c3c0e-...',
          },
        }),
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            required: ['code', 'message', 'details', 'requestId'],
            additionalProperties: true,
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string', nullable: true }, message: { type: 'string' } } } },
              requestId: { type: 'string', description: 'Also returned as the X-Request-Id header; quote it when reporting a problem.' },
            },
          },
        },
      },
      PageMeta: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          uptimeSeconds: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
          services: {
            type: 'object',
            properties: {
              database: { type: 'string', enum: ['up', 'down'] },
              ai: { type: 'string', enum: ['configured', 'degraded', 'disabled'], description: '`degraded` while the AI circuit breaker is open.' },
            },
          },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', maxLength: 128 } },
      },
      User: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          role: { type: 'string', enum: ['author', 'admin'] },
          name: { type: 'string' },
          email: { type: 'string' },
          authorCode: { type: 'string', nullable: true, example: 'AUTH003' },
          phone: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          joinedDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      RoyaltyBreakdown: {
        type: 'object',
        description: 'Derived from BookLeaf policy. All money fields are null (not 0) for books not yet published.',
        properties: {
          payoutStatus: { type: 'string', enum: ['not_yet_published', 'no_earnings_yet', 'awaiting_first_payout', 'partially_paid', 'fully_paid'] },
          royaltyPerCopy: { type: 'number', nullable: true },
          copiesSold: { type: 'integer', nullable: true },
          totalEarned: { type: 'number', nullable: true },
          paid: { type: 'number', nullable: true },
          pending: { type: 'number', nullable: true },
          paidPercentage: { type: 'integer', nullable: true },
          meetsPayoutThreshold: { type: 'boolean', nullable: true },
          rollsOverToNextQuarter: { type: 'boolean', nullable: true, description: 'Pending is above 0 but below the ₹1,000 minimum.' },
          payoutThreshold: { type: 'number', example: 1000 },
          lastPayoutDate: { type: 'string', format: 'date', nullable: true },
          nextScheduledPayout: {
            type: 'object',
            nullable: true,
            properties: { quarterEnd: { type: 'string', format: 'date' }, payoutBy: { type: 'string', format: 'date' } },
            description: 'Next quarter-end + 45 days deadline from today.',
          },
        },
      },
      ProductionProgress: {
        type: 'object',
        properties: {
          currentStage: { type: 'string', example: 'Cover Design' },
          stepNumber: { type: 'integer', nullable: true, example: 3 },
          totalSteps: { type: 'integer', example: 9 },
          stages: { type: 'array', items: { type: 'string' } },
        },
      },
      Book: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          authorId: { type: 'string' },
          bookId: { type: 'string', example: 'BK013' },
          title: { type: 'string' },
          isbn: { type: 'string' },
          genre: { type: 'string', nullable: true },
          publicationDate: { type: 'string', format: 'date-time', nullable: true },
          status: { type: 'string', example: 'In Production - Cover Design' },
          mrp: { type: 'number', nullable: true },
          royaltyPerCopy: { type: 'number', nullable: true },
          totalCopiesSold: { type: 'integer' },
          totalRoyaltyEarned: { type: 'number' },
          royaltyPaid: { type: 'number' },
          royaltyPending: { type: 'number' },
          lastRoyaltyPayoutDate: { type: 'string', format: 'date-time', nullable: true },
          printPartner: { type: 'string', nullable: true },
          availableOn: { type: 'array', items: { type: 'string' } },
          isPublished: { type: 'boolean' },
          royaltyBreakdown: ref('RoyaltyBreakdown'),
          production: ref('ProductionProgress'),
        },
      },
      Attachment: {
        type: 'object',
        properties: { fileName: { type: 'string' }, sizeBytes: { type: 'integer', nullable: true }, mimeType: { type: 'string', nullable: true }, url: { type: 'string', nullable: true } },
      },
      NewTicketInput: {
        type: 'object',
        required: ['subject', 'description'],
        properties: {
          bookId: { type: 'string', nullable: true, description: 'Book code or id; omit, null or "" for General / Account Level.' },
          subject: { type: 'string', minLength: 5, maxLength: 200 },
          description: { type: 'string', minLength: 20, maxLength: 5000 },
          attachments: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              required: ['fileName', 'sizeBytes', 'mimeType'],
              properties: {
                fileName: { type: 'string', maxLength: 255 },
                sizeBytes: { type: 'integer', maximum: 10485760 },
                mimeType: {
                  type: 'string',
                  enum: [
                    'image/jpeg',
                    'image/png',
                    'image/webp',
                    'application/pdf',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'text/plain',
                  ],
                },
              },
            },
          },
        },
      },
      MessageInput: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 5000 } } },
      Message: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          senderRole: { type: 'string', enum: ['author', 'admin'] },
          senderName: { type: 'string', nullable: true },
          body: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AdminMessage: {
        allOf: [ref('Message'), { type: 'object', properties: { isInternalNote: { type: 'boolean' }, wasAiDrafted: { type: 'boolean' } } }],
      },
      BookRef: { type: 'object', nullable: true, properties: { _id: { type: 'string' }, bookId: { type: 'string' }, title: { type: 'string' } } },
      PersonRef: { type: 'object', nullable: true, properties: { _id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, authorCode: { type: 'string', nullable: true } } },
      AuthorTicket: {
        type: 'object',
        description: 'Author view: never includes priority, AI fields, assignee or internal notes.',
        properties: {
          _id: { type: 'string' },
          ticketNumber: { type: 'string', example: 'BL-0005' },
          subject: { type: 'string' },
          description: { type: 'string' },
          attachments: { type: 'array', items: ref('Attachment') },
          status: { type: 'string', enum: STATUSES },
          category: { type: 'string', enum: CATEGORIES, nullable: true },
          book: ref('BookRef'),
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthorTicketListItem: {
        allOf: [
          ref('AuthorTicket'),
          {
            type: 'object',
            properties: {
              messageCount: { type: 'integer' },
              lastMessage: {
                type: 'object',
                nullable: true,
                properties: { senderRole: { type: 'string' }, preview: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
              },
              lastActivityAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      AuthorTicketDetail: { allOf: [ref('AuthorTicket'), { type: 'object', properties: { messages: { type: 'array', items: ref('Message') } } }] },
      AdminTicket: {
        allOf: [
          ref('AuthorTicket'),
          {
            type: 'object',
            properties: {
              author: ref('PersonRef'),
              priority: { type: 'string', enum: PRIORITIES, nullable: true },
              aiCategory: { type: 'string', enum: CATEGORIES, nullable: true },
              categoryOverridden: { type: 'boolean' },
              aiPriority: { type: 'string', enum: PRIORITIES, nullable: true },
              priorityOverridden: { type: 'boolean' },
              aiReasoning: { type: 'string', nullable: true },
              aiConfidence: { type: 'number', nullable: true },
              classificationSource: { type: 'string', enum: ['ai', 'rules'], nullable: true },
              aiStatus: { type: 'string', enum: ['pending', 'done', 'failed'] },
              aiError: { type: 'string', nullable: true },
              assignedTo: ref('PersonRef'),
              ageHours: { type: 'integer' },
              slaHours: { type: 'integer' },
              dueAt: { type: 'string', format: 'date-time' },
              isOverdue: { type: 'boolean' },
            },
          },
        ],
      },
      QueueItem: {
        allOf: [
          ref('AdminTicket'),
          {
            type: 'object',
            properties: {
              messageCount: { type: 'integer' },
              lastMessage: {
                type: 'object',
                nullable: true,
                properties: { senderRole: { type: 'string' }, isInternalNote: { type: 'boolean' }, preview: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
              },
              awaitingTeamResponse: { type: 'boolean' },
            },
          },
        ],
      },
      AdminTicketDetail: {
        allOf: [
          ref('AdminTicket'),
          {
            type: 'object',
            properties: {
              messages: { type: 'array', items: ref('AdminMessage') },
              book: { allOf: [ref('Book')], nullable: true },
              authorProfile: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  authorCode: { type: 'string' },
                  books: { type: 'object', properties: { total: { type: 'integer' }, published: { type: 'integer' }, totalRoyaltyEarned: { type: 'number' }, royaltyPaid: { type: 'number' }, royaltyPending: { type: 'number' } } },
                  tickets: { type: 'object', properties: { total: { type: 'integer' }, unresolved: { type: 'integer' } } },
                },
              },
              otherOpenTickets: { type: 'object', properties: { count: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } } } },
            },
          },
        ],
      },
      TicketUpdateInput: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          status: { type: 'string', enum: STATUSES },
          category: { type: 'string', enum: CATEGORIES },
          priority: { type: 'string', enum: PRIORITIES },
          assignedTo: { type: 'string', nullable: true, description: 'An admin user id, or null to unassign.' },
        },
      },
      AdminReplyInput: {
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: {
          body: { type: 'string', minLength: 1, maxLength: 5000 },
          wasAiDrafted: { type: 'boolean', default: false, description: 'True when the reply started from the AI draft (sent as-is or edited).' },
          status: { type: 'string', enum: STATUSES },
        },
      },
      AiDraft: {
        type: 'object',
        properties: {
          draftText: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          model: { type: 'string', example: 'gpt-4o-mini-2024-07-18' },
          cached: { type: 'boolean' },
          warnings: { type: 'array', items: { type: 'string' }, description: 'E.g. a ₹ amount not found in the author\'s records.' },
          context: { type: 'object', properties: { category: { type: 'string' }, sections: { type: 'array', items: { type: 'string' } }, exampleId: { type: 'string' } } },
          tokenUsage: { type: 'object', properties: { promptTokens: { type: 'integer' }, completionTokens: { type: 'integer' }, totalTokens: { type: 'integer' } } },
        },
      },
      AdminStats: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
          byCategory: { type: 'object', additionalProperties: { type: 'integer' } },
          byPriority: { type: 'object', additionalProperties: { type: 'integer' } },
          unresolved: {
            type: 'object',
            properties: {
              count: { type: 'integer' },
              averageAgeHours: { type: 'number', nullable: true },
              overdue: { type: 'integer' },
              unassigned: { type: 'integer' },
              byCategory: { type: 'object', additionalProperties: { type: 'integer' } },
              byPriority: { type: 'object', additionalProperties: { type: 'integer' } },
            },
          },
          ai: { type: 'object', description: 'Classification counts, category/priority override rates (over AI-classified tickets only), draft adoption.' },
        },
      },
      AiUsage: {
        type: 'object',
        properties: {
          windowDays: { type: 'integer' },
          model: { type: 'string' },
          pricing: { type: 'object' },
          totals: { type: 'object', properties: { calls: { type: 'integer' }, costUsd: { type: 'number' }, ticketsTouched: { type: 'integer' }, avgCostPerTicketUsd: { type: 'number', nullable: true } } },
          byFeature: { type: 'object', description: 'classify / draft: calls, success, error, skipped, cacheHits, tokens, costUsd, avgLatencyMs, failureRate.' },
          client: { type: 'object', properties: { enabled: { type: 'boolean' }, circuit: { type: 'string', enum: ['closed', 'open', 'half-open'] } } },
        },
      },
    },
  },
};

function errorResponse(description, code, message, details = []) {
  return {
    description,
    content: json(ref('Error'), { success: false, error: { code, message, details, requestId: '5d0c3c0e-1f2a-4c7b-9e1d-2b3c4d5e6f70' } }),
  };
}
