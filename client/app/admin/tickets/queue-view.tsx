"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Inbox, Search, Sparkles, X } from "lucide-react";
import { useAdminLive, useAdminLiveState } from "@/components/admin/admin-live";
import { AgeCell, CategoryBadge, ClassifyingShimmer, PriorityBadge, TriageSourceTag } from "@/components/admin/ticket-badges";
import { StatusBadge } from "@/components/tickets/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { type AdminQueueQuery, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, type QueueItem } from "@/lib/types";
import { useResource } from "@/lib/useResource";

const PAGE_SIZE = 20;

/** URL value → API status filter. No param means the working queue (Open + In Progress). */
const STATUS_OPTIONS = [
  { value: "", label: "Active (Open + In Progress)", api: "Open,In Progress" },
  { value: "all", label: "All statuses", api: undefined },
  ...TICKET_STATUSES.map((s) => ({ value: s, label: s, api: s })),
];

const SORT_OPTIONS = [
  { value: "", label: "Urgency, then age" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "updated", label: "Recently updated" },
];

/**
 * Filters live in the URL, but changing them needs no server round trip:
 * history.replaceState updates useSearchParams at once. With router.replace
 * a click on a filter checkbox was undone until the navigation finished.
 */
const replaceUrl = (url: string) => window.history.replaceState(null, "", url);

const FILTER_KEYS = ["status", "category", "priority", "assignedTo", "from", "to", "q", "overdue", "sort"] as const;

function TableSkeleton() {
  return (
    <LoadingRegion label="Loading the ticket queue">
      <div className="divide-y divide-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function QueueViewSkeleton() {
  return (
    <>
      <PageHeader title="Ticket queue" description="Every author ticket, most urgent and oldest first." />
      <Card>
        <TableSkeleton />
      </Card>
    </>
  );
}

const rowTone = (t: QueueItem, fresh: boolean) =>
  cn(
    fresh && "animate-slide-in bg-brand-50",
    !fresh && (t.priority === "Critical" || t.isOverdue) && t.status !== "Resolved" && t.status !== "Closed" && "bg-danger-50/45",
  );

const accent = (t: QueueItem) =>
  t.status === "Resolved" || t.status === "Closed"
    ? "shadow-[inset_3px_0_0_transparent]"
    : t.priority === "Critical" || t.isOverdue
      ? "shadow-[inset_3px_0_0_var(--color-danger-600)]"
      : t.priority === "High"
        ? "shadow-[inset_3px_0_0_#ea580c]"
        : "shadow-[inset_3px_0_0_transparent]";

function Triage({ t }: { t: QueueItem }) {
  if (t.aiStatus === "pending") return <ClassifyingShimmer />;
  return (
    <span className="flex flex-col items-start gap-1">
      <CategoryBadge category={t.category} />
      <TriageSourceTag aiStatus={t.aiStatus} source={t.classificationSource} />
    </span>
  );
}

export function QueueView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { markQueueSeen, freshIds, unseenCount } = useAdminLiveState();
  const searchRef = useRef<HTMLInputElement>(null);

  // The URL is the source of truth, but Next applies replaceState inside a
  // transition. Until it lands, read the change from here, or controlled
  // inputs (checkboxes, selects) snap back for a moment after a click.
  const [pendingUrl, setPendingUrl] = useState<{ base: string; next: string } | null>(null);
  const current = searchParams.toString();
  const params = pendingUrl?.base === current ? new URLSearchParams(pendingUrl.next) : searchParams;
  const param = (k: string) => params.get(k) ?? "";
  const setQuery = (qs: string) => {
    setPendingUrl({ base: current, next: qs });
    replaceUrl(qs ? `${pathname}?${qs}` : pathname);
  };
  const page = Math.max(1, Number(param("page")) || 1);
  const statusOption = STATUS_OPTIONS.find((o) => o.value === param("status")) ?? STATUS_OPTIONS[0];

  const query: AdminQueueQuery = {
    status: statusOption.api,
    category: param("category") || undefined,
    priority: param("priority") || undefined,
    assignedTo: param("assignedTo") || undefined,
    from: param("from") || undefined,
    to: param("to") || undefined,
    q: param("q") || undefined,
    overdue: param("overdue") || undefined,
    sort: param("sort") || undefined,
    page,
    limit: PAGE_SIZE,
  };
  const queryKey = JSON.stringify(query);
  const queue = useResource((signal) => api.admin.queue(query, signal), [queryKey]);

  // Being on the queue counts as having seen new tickets.
  useEffect(() => {
    if (unseenCount) markQueueSeen();
  }, [unseenCount, markQueueSeen]);

  // Live: coalesce bursts of events into one quiet refetch.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useAdminLive(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => queue.reload({ silent: true }), 250);
  });
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  // "/" jumps to search, as in most queue tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page"); // any filter change starts at page 1
    setQuery(next.toString());
  };

  // Debounced search box mirrored into the URL.
  const [search, setSearch] = useState(param("q"));
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setParams({ q: value.trim() || null }), 300);
  };

  const activeFilters = FILTER_KEYS.filter((k) => param(k)).length;
  const items = queue.data?.items ?? [];
  const meta = queue.data?.meta;
  const freshHere = items.filter((t) => freshIds.has(t._id)).length;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            Ticket queue
            {freshHere > 0 && (
              <Badge tone="brand" icon={<Sparkles className="size-3" aria-hidden />} className="animate-fade-in">
                {freshHere} new
              </Badge>
            )}
          </span>
        }
        description="Most urgent and oldest first. Critical and overdue tickets are highlighted. Updates arrive live."
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="relative sm:col-span-2 lg:col-span-4 xl:col-span-2">
            <label htmlFor="queue-search" className="sr-only">
              Search tickets
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              ref={searchRef}
              id="queue-search"
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search ticket, author, book, text…   ( / )"
              className="pl-9"
            />
          </div>
          {[
            {
              id: "status",
              label: "Status",
              value: statusOption.value,
              options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            },
            { id: "category", label: "Category", value: param("category"), options: [{ value: "", label: "All categories" }, ...TICKET_CATEGORIES.map((c) => ({ value: c, label: c }))] },
            { id: "priority", label: "Priority", value: param("priority"), options: [{ value: "", label: "All priorities" }, ...TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))] },
            { id: "sort", label: "Sort", value: param("sort"), options: SORT_OPTIONS },
          ].map((f) => (
            <div key={f.id}>
              <label htmlFor={`f-${f.id}`} className="sr-only">
                {f.label}
              </label>
              <Select id={`f-${f.id}`} value={f.value} onChange={(e) => setParams({ [f.id]: e.target.value || null })}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
          {/* Full width on phones: two fixed 10rem date inputs overflowed a 375px screen. */}
          <span className="flex w-full items-center gap-2 sm:inline-flex sm:w-auto">
            <label htmlFor="f-from" className="text-muted">
              From
            </label>
            <Input id="f-from" type="date" value={param("from")} max={param("to") || undefined} onChange={(e) => setParams({ from: e.target.value || null })} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" />
            <label htmlFor="f-to" className="text-muted">
              to
            </label>
            <Input id="f-to" type="date" value={param("to")} min={param("from") || undefined} onChange={(e) => setParams({ to: e.target.value || null })} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" />
          </span>
          {[
            { key: "assignedTo", on: "me", label: "Assigned to me" },
            { key: "assignedTo", on: "unassigned", label: "Unassigned" },
            { key: "overdue", on: "true", label: "Overdue only" },
          ].map((t) => (
            <label key={`${t.key}-${t.on}`} className="inline-flex cursor-pointer items-center gap-2 text-ink-2">
              <input
                type="checkbox"
                checked={param(t.key) === t.on}
                onChange={(e) => setParams({ [t.key]: e.target.checked ? t.on : null })}
                className="size-4 rounded border-line-strong accent-brand-700"
              />
              {t.label}
            </label>
          ))}
          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
            >
              <X className="size-3.5" aria-hidden /> Clear filters ({activeFilters})
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {queue.loading ? (
          <TableSkeleton />
        ) : queue.error ? (
          <ErrorState error={queue.error} onRetry={() => queue.reload()} title="We couldn't load the queue" />
        ) : !items.length ? (
          <EmptyState
            icon={activeFilters ? <Filter className="size-5" /> : <Inbox className="size-5" />}
            title={activeFilters ? "No tickets match these filters" : "The queue is empty"}
            description={activeFilters ? "Try widening the filters or clearing the search." : "New author tickets will appear here as they arrive."}
            action={
              activeFilters ? (
                <Button variant="secondary" onClick={() => setQuery("")}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Ticket queue, {meta?.total} tickets, sorted by {SORT_OPTIONS.find((o) => o.value === param("sort"))?.label}
                </caption>
                <thead className="border-b border-line bg-paper-2/50 text-left text-xs font-medium tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3">Ticket</th>
                    <th scope="col" className="px-3 py-3">Author</th>
                    <th scope="col" className="px-3 py-3">Subject</th>
                    <th scope="col" className="px-3 py-3">Category</th>
                    <th scope="col" className="px-3 py-3">Priority</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="px-3 py-3">Assignee</th>
                    <th scope="col" className="px-4 py-3 text-right">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((t) => (
                    <tr
                      key={t._id}
                      onClick={() => router.push(`/admin/tickets/${t.ticketNumber}`)}
                      className={cn("cursor-pointer align-top transition-colors hover:bg-paper-2/60", rowTone(t, freshIds.has(t._id)), accent(t))}
                    >
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-ink-2">{t.ticketNumber}</td>
                      <td className="px-3 py-3">
                        <span className="block max-w-40 truncate font-medium text-ink">{t.author?.name ?? "—"}</span>
                        <span className="block text-xs text-muted">{t.author?.authorCode}</span>
                      </td>
                      <td className="max-w-md px-3 py-3">
                        <Link
                          href={`/admin/tickets/${t.ticketNumber}`}
                          onClick={(e) => e.stopPropagation()}
                          className="line-clamp-1 font-medium text-ink hover:text-brand-800 hover:underline"
                        >
                          {t.subject}
                        </Link>
                        <span className="mt-0.5 line-clamp-1 text-xs text-muted">
                          {t.book ? t.book.title : "General / Account level"}
                          {t.awaitingTeamResponse && <span className="font-medium text-brand-700"> · Awaiting our reply</span>}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <Triage t={t} />
                      </td>
                      <td className="px-3 py-3">{t.aiStatus === "pending" ? <span className="text-xs text-muted">…</span> : <PriorityBadge priority={t.priority} />}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                        {t.assignedTo ? (t.assignedTo._id === user?._id ? "You" : t.assignedTo.name) : <span className="text-muted">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <AgeCell ageHours={t.ageHours} isOverdue={t.isOverdue} slaHours={t.slaHours} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile / tablet cards */}
            <ul className="divide-y divide-line lg:hidden">
              {items.map((t) => (
                <li key={t._id} className={cn(rowTone(t, freshIds.has(t._id)), accent(t))}>
                  <Link href={`/admin/tickets/${t.ticketNumber}`} className="block space-y-2 px-4 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted">{t.ticketNumber}</span>
                      <AgeCell ageHours={t.ageHours} isOverdue={t.isOverdue} slaHours={t.slaHours} />
                    </div>
                    <p className="font-medium text-ink">{t.subject}</p>
                    <p className="text-xs text-muted">
                      {t.author?.name} · {t.book ? t.book.title : "General"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={t.status} />
                      {t.aiStatus === "pending" ? <ClassifyingShimmer /> : <PriorityBadge priority={t.priority} />}
                      {t.aiStatus !== "pending" && <CategoryBadge category={t.category} />}
                      {t.aiStatus !== "pending" && <TriageSourceTag aiStatus={t.aiStatus} source={t.classificationSource} />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {meta && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
                <span>
                  {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
                </span>
                <span className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => setParams({ page: String(meta.page - 1) })}>
                    <ChevronLeft className="size-4" aria-hidden /> Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => setParams({ page: String(meta.page + 1) })}>
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </span>
              </nav>
            )}
          </>
        )}
      </Card>
    </>
  );
}
