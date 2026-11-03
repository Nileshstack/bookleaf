"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlarmClock, ArrowLeft, BookOpen, UserRound } from "lucide-react";
import { useAdminLive } from "@/components/admin/admin-live";
import { AdminThread } from "@/components/admin/admin-thread";
import { AuthorContextCard } from "@/components/admin/author-context";
import { DraftPanel } from "@/components/admin/draft-panel";
import { InternalNotes } from "@/components/admin/internal-notes";
import { CategoryBadge, ClassifyingShimmer, PriorityBadge } from "@/components/admin/ticket-badges";
import { TriageControls } from "@/components/admin/triage-controls";
import { StatusBadge } from "@/components/tickets/status-badge";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api";
import { ageLabel, date } from "@/lib/format";
import type { AdminMessage, TicketStatus } from "@/lib/types";
import { useResource } from "@/lib/useResource";

export function WorkspaceSkeleton() {
  return (
    <LoadingRegion label="Loading ticket">
      <Skeleton className="mb-5 h-4 w-24" />
      <Skeleton className="mb-3 h-8 w-2/3" />
      <Skeleton className="mb-8 h-4 w-1/3" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </LoadingRegion>
  );
}

export function TicketWorkspaceView() {
  const { id } = useParams<{ id: string }>();
  const ticket = useResource((signal) => api.admin.ticket(id, signal), [id]);

  // Live: the author replied, the AI classified it, or another agent changed it.
  useAdminLive((event) => {
    if (event.type === "resync") return ticket.reload({ silent: true });
    if (event.data.ticket.ticketNumber === ticket.data?.ticketNumber) ticket.reload({ silent: true });
  });

  const append = (message: AdminMessage, status?: TicketStatus) =>
    ticket.mutate((t) => (t && !t.messages.some((m) => m._id === message._id) ? { ...t, status: status ?? t.status, messages: [...t.messages, message] } : t));

  if (ticket.loading) return <WorkspaceSkeleton />;
  if (ticket.error || !ticket.data) {
    const notFound = ticket.error?.status === 404;
    return (
      <Card>
        <ErrorState
          error={notFound ? new ApiError({ status: 404, code: "NOT_FOUND", message: "No ticket with that number." }) : ticket.error}
          title={notFound ? "Ticket not found" : "We couldn't load this ticket"}
          onRetry={notFound ? undefined : () => ticket.reload()}
        />
        <div className="pb-8 text-center">
          <ButtonLink href="/admin/tickets" variant="secondary">
            Back to the queue
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const t = ticket.data;
  const publicMessages = t.messages.filter((m) => !m.isInternalNote);
  const notes = t.messages.filter((m) => m.isInternalNote);

  return (
    <div>
      <Link href="/admin/tickets" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Ticket queue
      </Link>

      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-paper-2 px-2 py-0.5 font-mono text-xs text-ink-2">{t.ticketNumber}</span>
          <StatusBadge status={t.status} />
          {t.aiStatus === "pending" ? (
            <ClassifyingShimmer />
          ) : (
            <>
              <PriorityBadge priority={t.priority} />
              <CategoryBadge category={t.category} />
            </>
          )}
          {t.isOverdue && (
            <Badge tone="danger" icon={<AlarmClock className="size-3" aria-hidden />}>
              Overdue · {ageLabel(t.ageHours)} old
            </Badge>
          )}
        </div>
        <h1 className="font-display text-2xl leading-tight font-semibold text-ink sm:text-3xl">{t.subject}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="size-4" aria-hidden /> {t.author?.name}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="size-4" aria-hidden /> {t.book ? t.book.title : "General / Account level"}
          </span>
          <span>Opened {date(t.createdAt)}</span>
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <AuthorContextCard ticket={t} />
          <Card className="p-4 sm:p-6">
            <AdminThread ticket={t} publicMessages={publicMessages} />
          </Card>
          <DraftPanel ticket={t} onSent={append} />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6" aria-label="Ticket controls and internal notes">
          <TriageControls ticket={t} onChange={(next) => ticket.mutate(() => next)} />
          <InternalNotes ticketNumber={t.ticketNumber} notes={notes} onAdded={(note) => append(note)} />
        </aside>
      </div>
    </div>
  );
}
