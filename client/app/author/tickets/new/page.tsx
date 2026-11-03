import type { Metadata } from "next";
import { Suspense } from "react";
import { FullPageLoader } from "@/components/ui/states";
import { NewTicketView } from "./new-ticket-view";

export const metadata: Metadata = { title: "Raise a ticket" };
// Client-side auth gate: see app/author/layout.tsx.
export const instant = false;

// Reads ?bookId= to pre-select a book, which needs a Suspense boundary.
export default function NewTicketPage() {
  return (
    <Suspense fallback={<FullPageLoader label="Loading form" />}>
      <NewTicketView />
    </Suspense>
  );
}
