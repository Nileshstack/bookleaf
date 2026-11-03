import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketDetailSkeleton, TicketDetailView } from "./ticket-detail-view";

export const metadata: Metadata = { title: "Ticket" };
// Client-side auth gate: see app/author/layout.tsx.
export const instant = false;

// The ticket id is only known at request time, so useParams suspends: Suspense is required.
export default function TicketDetailPage() {
  return (
    <Suspense fallback={<TicketDetailSkeleton />}>
      <TicketDetailView />
    </Suspense>
  );
}
