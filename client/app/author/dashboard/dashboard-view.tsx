"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Hourglass, IndianRupee, MessagesSquare, ShoppingBag, SquarePen } from "lucide-react";
import { useAuthorLive } from "@/components/author/author-live";
import { BookStatusBadge } from "@/components/books/book-parts";
import { TicketRow } from "@/components/tickets/ticket-row";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { count, date, firstName, greeting, inr } from "@/lib/format";
import type { Book } from "@/lib/types";
import { useResource } from "@/lib/useResource";

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700 [&>svg]:size-4" aria-hidden>
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </Card>
  );
}

/** Totals over published books only; books in production have no figures yet. */
const summarise = (books: Book[]) => {
  const live = books.filter((b) => b.isPublished);
  const sum = (pick: (b: Book) => number | null) => live.reduce((total, b) => total + (pick(b) ?? 0), 0);
  const nextPayout = live
    .map((b) => b.royaltyBreakdown.nextScheduledPayout?.payoutBy)
    .filter(Boolean)
    .sort()[0];
  return {
    total: books.length,
    published: live.length,
    inProduction: books.length - live.length,
    copies: sum((b) => b.royaltyBreakdown.copiesSold),
    earned: sum((b) => b.royaltyBreakdown.totalEarned),
    paid: sum((b) => b.royaltyBreakdown.paid),
    pending: sum((b) => b.royaltyBreakdown.pending),
    nextPayout,
  };
};

export function DashboardView() {
  const { user } = useAuth();
  const books = useResource((signal) => api.books.list(signal));
  const tickets = useResource((signal) => api.tickets.list({ limit: 5 }, signal));

  // Any reply, status change or resync can change the recent tickets card.
  useAuthorLive(() => tickets.reload({ silent: true }));

  const s = books.data ? summarise(books.data) : null;

  return (
    <>
      <PageHeader
        eyebrow={greeting()}
        title={`Welcome back, ${firstName(user?.name)}`}
        description="Here's how your books are doing, and where your conversations with the BookLeaf team stand."
        actions={
          <ButtonLink href="/author/tickets/new">
            <SquarePen className="size-4" aria-hidden /> Raise a ticket
          </ButtonLink>
        }
      />

      <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {books.loading ? (
          <>
            <span role="status" className="sr-only">
              Loading your summary
            </span>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="space-y-3 p-5" aria-hidden>
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-3 w-36" />
              </Card>
            ))}
          </>
        ) : books.error || !s ? (
          <Card className="sm:col-span-2 xl:col-span-4">
            <ErrorState error={books.error} onRetry={() => books.reload()} title="We couldn't load your summary" />
          </Card>
        ) : (
          <>
            <StatCard
              icon={<BookOpen />}
              label="Total books"
              value={count(s.total)}
              sub={`${s.published} published${s.inProduction ? ` · ${s.inProduction} in production` : ""}`}
            />
            <StatCard icon={<ShoppingBag />} label="Copies sold" value={count(s.copies)} sub="Across all published titles" />
            <StatCard icon={<IndianRupee />} label="Royalty earned" value={inr(s.earned)} sub={`${inr(s.paid)} paid out so far`} />
            <StatCard
              icon={<Hourglass />}
              label="Royalty pending"
              value={inr(s.pending)}
              sub={s.pending > 0 && s.nextPayout ? `Next payout deadline ${date(s.nextPayout)}` : "Nothing pending right now"}
            />
          </>
        )}
      </section>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent tickets"
            description="Your latest conversations with our support team"
            action={
              <Link href="/author/tickets" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                View all <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {tickets.loading ? (
            <LoadingRegion label="Loading recent tickets">
              <div className="divide-y divide-line">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2 px-5 py-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            </LoadingRegion>
          ) : tickets.error ? (
            <ErrorState error={tickets.error} onRetry={() => tickets.reload()} />
          ) : !tickets.data?.items.length ? (
            <EmptyState
              icon={<MessagesSquare className="size-5" />}
              title="No tickets yet"
              description="Questions about royalties, ISBNs, printing or your book's progress? Our team is here to help."
              action={<ButtonLink href="/author/tickets/new">Raise your first ticket</ButtonLink>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {tickets.data.items.map((t) => (
                <li key={t._id}>
                  <TicketRow ticket={t} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Your books"
            action={
              <Link href="/author/books" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Details <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {books.loading ? (
            <LoadingRegion label="Loading your books">
              <div className="space-y-3 p-5">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            </LoadingRegion>
          ) : books.data?.length ? (
            <ul className="divide-y divide-line">
              {books.data.map((b) => (
                <li key={b._id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-ink">{b.title}</p>
                    <BookStatusBadge book={b} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {b.isPublished
                      ? `${count(b.royaltyBreakdown.copiesSold)} sold · ${inr(b.royaltyBreakdown.pending)} pending`
                      : `${b.production.currentStage}${b.production.stepNumber ? ` · step ${b.production.stepNumber} of ${b.production.totalSteps}` : ""}`}
                  </p>
                </li>
              ))}
            </ul>
          ) : !books.error ? (
            <p className="p-5 text-sm text-muted">No books on your account yet.</p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
