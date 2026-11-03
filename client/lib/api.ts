import type { Book, FieldError, PageMeta, TicketDetail, TicketListItem, TicketStatus, User } from "./types";

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

  constructor({ status, code, message, details = [], requestId }: { status: number; code: string; message: string; details?: FieldError[]; requestId?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
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
    throw new ApiError({
      status: response.status,
      code: json?.error?.code ?? "UNKNOWN_ERROR",
      message: json?.error?.message ?? `Something went wrong (HTTP ${response.status}). Please try again.`,
      details: json?.error?.details ?? [],
      requestId: json?.error?.requestId,
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
  streams: {
    author: `${API_URL}/tickets/stream`,
    admin: `${API_URL}/admin/tickets/stream`,
  },
};
