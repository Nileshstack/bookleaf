import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketsView, TicketsViewSkeleton } from "./tickets-view";

export const metadata: Metadata = { title: "My tickets" };
// Client-side auth gate: see app/author/layout.tsx.
export const instant = false;

// The status filter lives in the URL (?status=), which needs a Suspense boundary.
export default function TicketsPage() {
  return (
    <Suspense fallback={<TicketsViewSkeleton />}>
      <TicketsView />
    </Suspense>
  );
}
