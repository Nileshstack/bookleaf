"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AdminReplyEvent, StatusChangedEvent } from "@/lib/types";
import { type SSEStatus, useSSE } from "@/lib/useSSE";

/**
 * One live stream per author tab, shared by every page through context. The
 * server caps streams per user, and pages come and go, so the stream lives in
 * the layout and pages subscribe to it.
 *
 * Toast policy: a reply or status change always toasts, with a "View" action
 * unless the author is already on that ticket. The ticket page appends the
 * message itself.
 */

type AuthorEvent = { type: "admin_reply"; data: AdminReplyEvent } | { type: "status_changed"; data: StatusChangedEvent } | { type: "resync" };

type Listener = (event: AuthorEvent) => void;

const AuthorLiveContext = createContext<{ status: SSEStatus; subscribe: (l: Listener) => () => void } | null>(null);

export function AuthorLiveProvider({ children }: { children: (status: SSEStatus) => React.ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const router = useRouter();
  const pathname = usePathname();

  const emit = (event: AuthorEvent) => listeners.current.forEach((l) => l(event));

  // Read inside SSE callbacks, so it must always hold the current path.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const viewing = (ticketNumber: string) => pathRef.current === `/author/tickets/${ticketNumber}`;
  const open = (ticketNumber: string) => router.push(`/author/tickets/${ticketNumber}`);

  const status = useSSE(
    api.streams.author,
    {
      admin_reply: (raw) => {
        const data = raw as AdminReplyEvent;
        emit({ type: "admin_reply", data });
        toast.success(`New reply on ${data.ticket.ticketNumber}`, {
          description: data.message.body.length > 90 ? `${data.message.body.slice(0, 90)}…` : data.message.body,
          action: viewing(data.ticket.ticketNumber) ? undefined : { label: "View", onClick: () => open(data.ticket.ticketNumber) },
        });
      },
      status_changed: (raw) => {
        const data = raw as StatusChangedEvent;
        emit({ type: "status_changed", data });
        toast.info(`${data.ticket.ticketNumber} is now ${data.ticket.status}`, {
          action: viewing(data.ticket.ticketNumber) ? undefined : { label: "View", onClick: () => open(data.ticket.ticketNumber) },
        });
      },
    },
    { onResync: () => emit({ type: "resync" }) },
  );

  // Stable identity, so page subscriptions don't churn on every render.
  const subscribe = useCallback((listener: Listener) => {
    const set = listeners.current;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }, []);
  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <AuthorLiveContext.Provider value={value}>{children(status)}</AuthorLiveContext.Provider>;
}

/** Runs `handler` for every live event while the calling component is visible. */
export function useAuthorLive(handler: (event: AuthorEvent) => void) {
  const ctx = useContext(AuthorLiveContext);
  if (!ctx) throw new Error("useAuthorLive must be used inside AuthorLiveProvider");
  const onEvent = useEffectEvent(handler);
  const { subscribe } = ctx;
  useEffect(() => subscribe((e) => onEvent(e)), [subscribe]);
}
