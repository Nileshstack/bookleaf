"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Inbox, SquarePen } from "lucide-react";
import { useAuthorLive } from "@/components/author/author-live";
import { TicketRow } from "@/components/tickets/ticket-row";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TICKET_STATUSES, type TicketListItem, type TicketStatus } from "@/lib/types";
import { useResource } from "@/lib/useResource";

const PAGE_SIZE = 10;
const FILTERS: (TicketStatus | "All")[] = ["All", ...TICKET_STATUSES];

function ListSkeleton() {
  return (
    <LoadingRegion label="Loading your tickets">
      <div className="divide-y divide-line">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function TicketsViewSkeleton() {
  return (
    <>
      <PageHeader title="My tickets" description="Every question you've raised with BookLeaf, and our replies." />
      <Card>
        <ListSkeleton />
      </Card>
    </>
  );
}

export function TicketsView() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const raw = searchParams.get("status");
  const status = (TICKET_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as TicketStatus) : undefined;

  const firstPage = useResource((signal) => api.tickets.list({ status, page: 1, limit: PAGE_SIZE }, signal), [status]);
  const [extra, setExtra] = useState<{ status?: TicketStatus; items: TicketListItem[]; page: number }>({ items: [], page: 1 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiError | null>(null);

  // Extra pages belong to the filter they were loaded for; a new filter starts over.
  const more = extra.status === status ? extra : { status, items: [], page: 1 };
  const items = [...(firstPage.data?.items ?? []), ...more.items];
  const total = firstPage.data?.meta.total ?? 0;

  useAuthorLive(() => {
    setExtra({ status, items: [], page: 1 });
    firstPage.reload({ silent: true });
  });

  const setFilter = (next: TicketStatus | "All") => {
    const params = new URLSearchParams(searchParams);
    if (next === "All") params.delete("status");
    else params.set("status", next);
    const query = params.toString();
    // No server round trip needed for a filter; useSearchParams updates at once.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const nextPage = more.page + 1;
      const res = await api.tickets.list({ status, page: nextPage, limit: PAGE_SIZE });
      setExtra({ status, items: [...more.items, ...res.items], page: nextPage });
    } catch (err) {
      setMoreError(err as ApiError);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <PageHeader
        title="My tickets"
        description="Every question you've raised with BookLeaf, and our replies. New replies appear here instantly."
        actions={
          <ButtonLink href="/author/tickets/new">
            <SquarePen className="size-4" aria-hidden /> Raise a ticket
          </ButtonLink>
        }
      />

      <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
        <div role="group" aria-label="Filter by status" className="inline-flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
          {FILTERS.map((f) => {
            const active = (f === "All" && !status) || f === status;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-brand-700 text-white shadow-sm" : "text-ink-2 hover:bg-paper-2",
                )}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        {firstPage.loading ? (
          <ListSkeleton />
        ) : firstPage.error ? (
          <ErrorState error={firstPage.error} onRetry={() => firstPage.reload()} title="We couldn't load your tickets" />
        ) : !items.length ? (
          status ? (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title={`No ${status.toLowerCase()} tickets`}
              description="Try another filter to see the rest of your tickets."
              action={
                <Button variant="secondary" onClick={() => setFilter("All")}>
                  Show all tickets
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title="You haven't raised any tickets"
              description="Ask us anything about royalties, ISBNs, printing, distribution or your book's progress."
              action={<ButtonLink href="/author/tickets/new">Raise a ticket</ButtonLink>}
            />
          )
        ) : (
          <>
            <p className="sr-only" aria-live="polite">
              Showing {items.length} of {total} tickets
            </p>
            <ul className="divide-y divide-line">
              {items.map((t) => (
                <li key={t._id}>
                  <TicketRow ticket={t} />
                </li>
              ))}
            </ul>
            <div className="flex flex-col items-center gap-2 border-t border-line px-5 py-3 text-sm text-muted sm:flex-row sm:justify-between">
              <span>
                Showing {items.length} of {total}
              </span>
              {items.length < total && (
                <Button variant="secondary" size="sm" onClick={loadMore} loading={loadingMore}>
                  Load more
                </Button>
              )}
            </div>
            {moreError && (
              <p role="alert" className="px-5 pb-3 text-sm text-danger-600">
                {moreError.message}
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
