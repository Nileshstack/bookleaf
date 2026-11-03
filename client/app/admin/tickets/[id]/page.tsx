import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceSkeleton, TicketWorkspaceView } from "./ticket-workspace-view";

export const metadata: Metadata = { title: "Ticket workspace" };
// Client-side auth gate: see app/admin/layout.tsx.
export const instant = false;

// The ticket id is only known at request time, so useParams suspends: Suspense is required.
export default function AdminTicketPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <TicketWorkspaceView />
    </Suspense>
  );
}
