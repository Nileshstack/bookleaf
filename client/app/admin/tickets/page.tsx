import type { Metadata } from "next";
import { Suspense } from "react";
import { QueueView, QueueViewSkeleton } from "./queue-view";

export const metadata: Metadata = { title: "Ticket queue" };
// Client-side auth gate: see app/admin/layout.tsx.
export const instant = false;

// Filters live in the URL (shareable, back-button friendly), which needs Suspense.
export default function QueuePage() {
  return (
    <Suspense fallback={<QueueViewSkeleton />}>
      <QueueView />
    </Suspense>
  );
}
