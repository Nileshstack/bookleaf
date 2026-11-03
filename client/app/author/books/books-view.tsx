"use client";

import { BookOpen } from "lucide-react";
import { BookCard } from "@/components/books/book-card";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useResource";

function BooksSkeleton() {
  return (
    <LoadingRegion label="Loading your books">
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-5 p-5">
            <div className="flex justify-between">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-10" />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-4 border-t border-line pt-5">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-12" />
              ))}
            </div>
            <Skeleton className="h-12" />
          </Card>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function BooksView() {
  const books = useResource((signal) => api.books.list(signal));
  const published = books.data?.filter((b) => b.isPublished).length ?? 0;
  const inProduction = (books.data?.length ?? 0) - published;

  return (
    <>
      <PageHeader
        title="My books"
        description={
          books.data?.length
            ? `${published} published${inProduction ? ` · ${inProduction} in production` : ""}. Royalty figures update with each quarterly statement.`
            : "Sales, royalties and production status for every title."
        }
        actions={<ButtonLink href="/author/tickets/new" variant="secondary">Ask a question</ButtonLink>}
      />

      {books.loading ? (
        <BooksSkeleton />
      ) : books.error ? (
        <Card>
          <ErrorState error={books.error} onRetry={() => books.reload()} title="We couldn't load your books" />
        </Card>
      ) : !books.data?.length ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="No books yet"
            description="Once your manuscript is with us, you'll be able to follow it through production here."
          />
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {books.data.map((book) => (
            <BookCard key={book._id} book={book} />
          ))}
        </div>
      )}
    </>
  );
}
