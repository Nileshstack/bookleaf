import Link from "next/link";
import { BookOpen, Mail, MapPin, UserRound } from "lucide-react";
import { BookStatusBadge, PlatformBadges } from "@/components/books/book-parts";
import { Card } from "@/components/ui/card";
import { count, date, inr } from "@/lib/format";
import type { AdminTicketDetail } from "@/lib/types";
import { PriorityBadge } from "./ticket-badges";

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Everything an agent needs to answer without leaving the ticket: who the
 * author is, the referenced book's real figures, and their other open
 * tickets.
 */
export function AuthorContextCard({ ticket }: { ticket: AdminTicketDetail }) {
  const p = ticket.authorProfile;
  const book = ticket.book;
  const r = book?.royaltyBreakdown;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-brand-100 text-brand-800" aria-hidden>
            <UserRound className="size-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{p?.name ?? ticket.author?.name}</h2>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              {p?.authorCode && <span className="font-mono">{p.authorCode}</span>}
              {p?.email && (
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                  <Mail className="size-3" aria-hidden />
                  {p.email}
                </a>
              )}
              {p?.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {p.city}
                </span>
              )}
              {p?.joinedDate && <span>Author since {date(p.joinedDate)}</span>}
            </p>
          </div>
        </div>
        {p && (
          <p className="text-xs text-muted">
            {p.tickets.total} tickets · {p.tickets.unresolved} open
          </p>
        )}
      </div>

      {p && (
        <dl className="grid grid-cols-2 gap-4 border-b border-line px-5 py-4 sm:grid-cols-4">
          <Fig label="Books" value={`${p.books.total} (${p.books.published} live)`} />
          <Fig label="Royalty earned" value={inr(p.books.totalRoyaltyEarned)} />
          <Fig label="Paid" value={inr(p.books.royaltyPaid)} />
          <Fig label="Pending" value={inr(p.books.royaltyPending)} />
        </dl>
      )}

      <div className="px-5 py-4">
        {!book ? (
          <p className="text-sm text-muted">General / account-level ticket. No specific book selected.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 font-medium text-ink">
                <BookOpen className="size-4 text-muted" aria-hidden />
                {book.title} <span className="font-mono text-xs text-muted">{book.bookId}</span>
              </p>
              <BookStatusBadge book={book} />
            </div>
            {book.isPublished && r ? (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <Fig label="Copies sold" value={count(r.copiesSold)} />
                  <Fig label="Earned" value={inr(r.totalEarned)} />
                  <Fig label="Paid" value={inr(r.paid)} />
                  <Fig label="Pending" value={inr(r.pending)} />
                  <Fig label="Last payout" value={r.lastPayoutDate ? date(r.lastPayoutDate) : "Never"} />
                </dl>
                <p className="text-xs text-muted">
                  MRP {inr(book.mrp)} · {inr(book.royaltyPerCopy)}/copy · printed by {book.printPartner ?? "—"}
                  {r.nextScheduledPayout && ` · next payout deadline ${date(r.nextScheduledPayout.payoutBy)}`}
                  {r.rollsOverToNextQuarter && " · below the ₹1,000 minimum (rolls over)"}
                </p>
                <PlatformBadges platforms={book.availableOn} />
              </>
            ) : (
              <p className="text-sm text-ink-2">
                In production: <span className="font-medium">{book.production.currentStage}</span>
                {book.production.stepNumber && ` (step ${book.production.stepNumber} of ${book.production.totalSteps})`}. No sales or
                royalty figures yet.
              </p>
            )}
          </div>
        )}
      </div>

      {ticket.otherOpenTickets.count > 0 && (
        <div className="border-t border-line px-5 py-3">
          <p className="mb-2 text-xs font-medium text-muted">Other open tickets from this author ({ticket.otherOpenTickets.count})</p>
          <ul className="space-y-1.5">
            {ticket.otherOpenTickets.items.map((o) => (
              <li key={o._id} className="flex items-center gap-2 text-sm">
                <Link href={`/admin/tickets/${o.ticketNumber}`} className="font-mono text-xs text-brand-700 hover:underline">
                  {o.ticketNumber}
                </Link>
                <span className="min-w-0 flex-1 truncate text-ink-2">{o.subject}</span>
                <PriorityBadge priority={o.priority} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
