import Link from "next/link";
import { BookOpen, ChevronRight, CornerDownRight, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { relative } from "@/lib/format";
import type { TicketListItem } from "@/lib/types";
import { StatusBadge } from "./status-badge";

/**
 * One ticket in a list. Shows author-safe fields only: no priority, no AI
 * data. When the team spoke last on an open ticket, it says so.
 */
export function TicketRow({ ticket }: { ticket: TicketListItem }) {
  const teamReplied = ticket.lastMessage?.senderRole === "admin" && (ticket.status === "Open" || ticket.status === "In Progress");

  return (
    <Link
      href={`/author/tickets/${ticket.ticketNumber}`}
      className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-paper-2/50 focus-visible:bg-paper-2/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-muted">{ticket.ticketNumber}</span>
          <StatusBadge status={ticket.status} />
          {teamReplied && <Badge tone="brand">New reply</Badge>}
        </div>
        <p className="mt-1.5 truncate font-medium text-ink group-hover:text-brand-800">{ticket.subject}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            {ticket.book ? <BookOpen className="size-3.5" aria-hidden /> : <UserRound className="size-3.5" aria-hidden />}
            {ticket.book ? ticket.book.title : "General / Account level"}
          </span>
          {ticket.category && <span>{ticket.category}</span>}
          <span>Updated {relative(ticket.lastActivityAt)}</span>
        </p>
        {ticket.lastMessage && (
          <p className="mt-2 flex gap-1.5 text-sm text-ink-2">
            <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="line-clamp-1">
              <span className="font-medium">{ticket.lastMessage.senderRole === "admin" ? "BookLeaf team" : "You"}:</span>{" "}
              {ticket.lastMessage.preview}
            </span>
          </p>
        )}
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
