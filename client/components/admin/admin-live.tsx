"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AdminLiveEvent } from "@/lib/types";
import { type SSEStatus, useSSE } from "@/lib/useSSE";

/**
 * One admin stream per tab, shared by every admin page.
 *
 * - Toasts: a new ticket always gets one (with "Open"), and so does an author
 *   reply. Classification and edits update views silently, since they would
 *   be noise in a busy queue.
 * - unseenCount feeds the sidebar badge until the queue is looked at.
 * - freshIds are tickets that arrived in the last few seconds, so the queue
 *   can highlight them as they slide in.
 */

type Listener = (event: AdminLiveEvent) => void;

interface AdminLiveValue {
  status: SSEStatus;
  subscribe: (listener: Listener) => () => void;
  unseenCount: number;
  markQueueSeen: () => void;
  freshIds: ReadonlySet<string>;
}

const AdminLiveContext = createContext<AdminLiveValue | null>(null);

const FRESH_MS = 8000;

export function AdminLiveProvider({ children }: { children: (state: { status: SSEStatus; unseenCount: number }) => React.ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const router = useRouter();
  const pathname = usePathname();
  const [unseenCount, setUnseenCount] = useState(0);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());

  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const emit = (event: AdminLiveEvent) => listeners.current.forEach((l) => l(event));
  const viewing = (ticketNumber: string) => pathRef.current === `/admin/tickets/${ticketNumber}`;
  const open = (ticketNumber: string) => router.push(`/admin/tickets/${ticketNumber}`);

  const markFresh = (ticketId: string) => {
    setFreshIds((s) => new Set(s).add(ticketId));
    setTimeout(
      () =>
        setFreshIds((s) => {
          const next = new Set(s);
          next.delete(ticketId);
          return next;
        }),
      FRESH_MS,
    );
  };

  const status = useSSE(
    api.streams.admin,
    {
      new_ticket: (raw) => {
        const data = raw as Extract<AdminLiveEvent, { type: "new_ticket" }>["data"];
        markFresh(data.ticket.ticketId);
        if (pathRef.current !== "/admin/tickets") setUnseenCount((n) => n + 1);
        emit({ type: "new_ticket", data });
        toast(`New ticket ${data.ticket.ticketNumber}`, {
          description: `${data.authorName}: ${data.ticket.subject}`,
          action: { label: "Open", onClick: () => open(data.ticket.ticketNumber) },
        });
      },
      ticket_classified: (raw) => emit({ type: "ticket_classified", data: raw as Extract<AdminLiveEvent, { type: "ticket_classified" }>["data"] }),
      ticket_updated: (raw) => emit({ type: "ticket_updated", data: raw as Extract<AdminLiveEvent, { type: "ticket_updated" }>["data"] }),
      author_reply: (raw) => {
        const data = raw as Extract<AdminLiveEvent, { type: "author_reply" }>["data"];
        emit({ type: "author_reply", data });
        toast.info(`${data.authorName} replied on ${data.ticket.ticketNumber}${data.reopened ? " (reopened)" : ""}`, {
          description: data.preview,
          action: viewing(data.ticket.ticketNumber) ? undefined : { label: "Open", onClick: () => open(data.ticket.ticketNumber) },
        });
      },
    },
    { onResync: () => emit({ type: "resync" }) },
  );

  const subscribe = useCallback((listener: Listener) => {
    const set = listeners.current;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }, []);
  const markQueueSeen = useCallback(() => setUnseenCount(0), []);

  const value = useMemo(
    () => ({ status, subscribe, unseenCount, markQueueSeen, freshIds }),
    [status, subscribe, unseenCount, markQueueSeen, freshIds],
  );
  return <AdminLiveContext.Provider value={value}>{children({ status, unseenCount })}</AdminLiveContext.Provider>;
}

function useAdminLiveContext() {
  const ctx = useContext(AdminLiveContext);
  if (!ctx) throw new Error("Admin live hooks must be used inside AdminLiveProvider");
  return ctx;
}

/** Runs `handler` for every admin live event while the calling component is visible. */
export function useAdminLive(handler: (event: AdminLiveEvent) => void) {
  const { subscribe } = useAdminLiveContext();
  const onEvent = useEffectEvent(handler);
  useEffect(() => subscribe((e) => onEvent(e)), [subscribe]);
}

export const useAdminLiveState = () => {
  const { unseenCount, markQueueSeen, freshIds, status } = useAdminLiveContext();
  return { unseenCount, markQueueSeen, freshIds, status };
};
