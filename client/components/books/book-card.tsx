import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { count, date, DASH, inr } from "@/lib/format";
import type { Book } from "@/lib/types";
import { BookStatusBadge, Figure, PaidBar, PayoutNote, PlatformBadges, ProductionStepper } from "./book-parts";

export function BookCard({ book }: { book: Book }) {
  const r = book.royaltyBreakdown;
  const headingId = `book-${book.bookId}`;

  return (
    <Card className="flex flex-col" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-xl leading-snug font-semibold text-ink">
            {book.title}
          </h2>
          <p className="mt-1 text-sm text-muted">{book.genre ?? "Genre not set"}</p>
        </div>
        <BookStatusBadge book={book} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 px-5 sm:grid-cols-3">
        <Figure label="ISBN" value={book.isbn} />
        <Figure label="Published" value={book.isPublished ? date(book.publicationDate) : DASH} />
        <Figure label="MRP" value={inr(book.mrp)} />
      </dl>

      <div className="mt-5 flex-1 border-t border-line px-5 py-5">
        {book.isPublished ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Figure label="Copies sold" value={count(r.copiesSold)} emphasis />
              <Figure label="Royalty earned" value={inr(r.totalEarned)} emphasis />
              <Figure label="Paid" value={inr(r.paid)} emphasis />
              <Figure label="Pending" value={inr(r.pending)} emphasis />
            </dl>
            <PaidBar royalty={r} />
            <PayoutNote royalty={r} />
            <div>
              <p className="mb-1.5 text-xs text-muted">Available on</p>
              <PlatformBadges platforms={book.availableOn} />
            </div>
          </div>
        ) : (
          <ProductionStepper production={book.production} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
        <span>
          {book.bookId}
          {book.printPartner ? ` · Printed by ${book.printPartner}` : ""}
        </span>
        <Link
          href={`/author/tickets/new?bookId=${encodeURIComponent(book.bookId)}`}
          className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800 hover:underline"
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
          Ask about this book
        </Link>
      </div>
    </Card>
  );
}
