import type {
  AdminMessage,
  AdminStats,
  AdminTicketDetail,
  AiDraft,
  AiUsageSummary,
  Book,
  FieldError,
  PageMeta,
  QueueItem,
  TicketCategory,
  TicketDetail,
  TicketListItem,
  TicketPriority,
  TicketStatus,
  User,
} from "./types";

/**
 * Typed client for the BookLeaf API.
 *
 * - Every request sends cookies (credentials: "include"). The session is an
 *   httpOnly cookie set by the API, so tokens never touch JavaScript.
 * - Every failure becomes an ApiError with the server's code, message and
 *   per-field details, including network failures. Components therefore
 *   handle one error shape.
 * - A 401 from any call notifies the auth layer (onUnauthorized), so an
 *   expired session sends the user back to login from anywhere.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldError[];
  readonly requestId?: string;
  /** Extra machine-readable fields some errors carry, e.g. { fallback: { template } } on AI_UNAVAILABLE. */
  readonly extra: Record<string, unknown>;

  constructor({
    status,
    code,
    message,
    details = [],
    requestId,
    extra = {},
  }: {
    status: number;
    code: string;
    message: string;
    details?: FieldError[];
    requestId?: string;
    extra?: Record<string, unknown>;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.extra = extra;
  }

  /** Field errors keyed by field name, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.filter((d) => d.field).map((d) => [d.field as string, d.message]));
  }
}

type Unauthorized = () => void;
const unauthorizedListeners = new Set<Unauthorized>();
export const onUnauthorized = (listener: Unauthorized) => {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
};

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Don't broadcast a 401, e.g. for the initial "who am I" check or a failed login. */
  quiet401?: boolean;
}

const buildUrl = (path: string, query?: Query) => {
  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
};

async function request<T>(path: string, { method = "GET", body, query, signal, quiet401 }: RequestOptions = {}) {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "We couldn't reach BookLeaf. Check your connection and try again.",
    });
  }

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.success) {
    if (response.status === 401 && !quiet401) unauthorizedListeners.forEach((l) => l());
    const { code, message, details, requestId, ...extra } = json?.error ?? {};
    throw new ApiError({
      status: response.status,
      code: code ?? "UNKNOWN_ERROR",
      message: message ?? `Something went wrong (HTTP ${response.status}). Please try again.`,
      details: details ?? [],
      requestId,
      extra,
    });
  }

  return { data: json.data as T, meta: json.meta as PageMeta | undefined };
}

export interface NewTicketInput {
  bookId: string | null;
  subject: string;
  description: string;
  attachments: { fileName: string; sizeBytes: number; mimeType: string }[];
}

export interface AdminQueueQuery {
  status?: string;
  category?: string;
  priority?: string;
  assignedTo?: string;
  from?: string;
  to?: string;
  q?: string;
  overdue?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface AdminReplyInput {
  body: string;
  wasAiDrafted: boolean;
  status?: TicketStatus;
}

const adminTicketPath = (ref: string, suffix = "") => `/admin/tickets/${encodeURIComponent(ref)}${suffix}`;

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ user: User }>("/auth/login", { method: "POST", body: { email, password }, quiet401: true }).then((r) => r.data.user),
    logout: () => request<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }),
    me: (signal?: AbortSignal) => request<{ user: User }>("/auth/me", { signal, quiet401: true }).then((r) => r.data.user),
  },
  books: {
    list: (signal?: AbortSignal) => request<Book[]>("/books", { signal }).then((r) => r.data),
    get: (ref: string, signal?: AbortSignal) => request<Book>(`/books/${encodeURIComponent(ref)}`, { signal }).then((r) => r.data),
  },
  tickets: {
    list: (query: { status?: TicketStatus; page?: number; limit?: number } = {}, signal?: AbortSignal) =>
      request<TicketListItem[]>("/tickets", { query, signal }).then((r) => ({ items: r.data, meta: r.meta as PageMeta })),
    get: (ref: string, signal?: AbortSignal) =>
      request<TicketDetail>(`/tickets/${encodeURIComponent(ref)}`, { signal }).then((r) => r.data),
    create: (input: NewTicketInput) => request<TicketDetail>("/tickets", { method: "POST", body: input }).then((r) => r.data),
    reply: (ref: string, body: string) =>
      request<{ message: TicketDetail["messages"][number]; ticket: { ticketNumber: string; status: TicketStatus; reopened: boolean } }>(
        `/tickets/${encodeURIComponent(ref)}/messages`,
        { method: "POST", body: { body } },
      ).then((r) => r.data),
  },
  admin: {
    stats: (signal?: AbortSignal) => request<AdminStats>("/admin/stats", { signal }).then((r) => r.data),
    aiUsage: (signal?: AbortSignal) =>
      request<AiUsageSummary>("/admin/ai/usage", { query: { days: 30 }, signal }).then((r) => r.data),
    queue: (query: AdminQueueQuery, signal?: AbortSignal) =>
      request<QueueItem[]>("/admin/tickets", { query: { ...query }, signal }).then((r) => ({ items: r.data, meta: r.meta as PageMeta })),
    ticket: (ref: string, signal?: AbortSignal) => request<AdminTicketDetail>(adminTicketPath(ref), { signal }).then((r) => r.data),
    update: (
      ref: string,
      changes: { status?: TicketStatus; category?: TicketCategory; priority?: TicketPriority; assignedTo?: string | null },
    ) => request<AdminTicketDetail>(adminTicketPath(ref), { method: "PATCH", body: changes }).then((r) => r.data),
    assignToMe: (ref: string) =>
      request<AdminTicketDetail>(adminTicketPath(ref, "/assign-to-me"), { method: "POST" }).then((r) => r.data),
    addNote: (ref: string, body: string) =>
      request<AdminMessage>(adminTicketPath(ref, "/notes"), { method: "POST", body: { body } }).then((r) => r.data),
    reply: (ref: string, input: AdminReplyInput) =>
      request<{ message: AdminMessage; ticket: { ticketNumber: string; status: TicketStatus } }>(adminTicketPath(ref, "/reply"), {
        method: "POST",
        body: input,
      }).then((r) => r.data),
    draft: (ref: string, { regenerate = false }: { regenerate?: boolean } = {}) =>
      request<AiDraft>(adminTicketPath(ref, "/draft"), { method: "POST", query: { regenerate: String(regenerate) } }).then((r) => r.data),
    classify: (ref: string) =>
      request<AdminTicketDetail>(adminTicketPath(ref, "/classify"), { method: "POST" }).then((r) => r.data),
  },
  streams: {
    author: `${API_URL}/tickets/stream`,
    admin: `${API_URL}/admin/tickets/stream`,
  },
};
