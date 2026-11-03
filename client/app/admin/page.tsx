import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Admin" };
// Client-side auth gate: see app/admin/layout.tsx.
export const instant = false;

// Placeholder until the admin console is built; the admin API is already live.
export default function AdminHomePage() {
  return (
    <>
      <PageHeader title="Ticket queue" description="The operations console for BookLeaf support." />
      <Card>
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="Admin console coming next"
          description="The queue, AI drafts and ticket management APIs are ready. This screen is the next part of the frontend."
        />
      </Card>
    </>
  );
}
