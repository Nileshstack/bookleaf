import { FileText, Sparkles, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { dateTime, fileSize } from "@/lib/format";
import type { AdminMessage, AdminTicketDetail } from "@/lib/types";

function Bubble({
  team,
  name,
  time,
  aiAssisted,
  children,
}: {
  team: boolean;
  name: string;
  time: string;
  aiAssisted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("flex animate-fade-in gap-3", team && "flex-row-reverse")}>
      <span className={cn("mt-1 grid size-8 shrink-0 place-items-center rounded-full", team ? "bg-surface ring-1 ring-line" : "bg-paper-2 text-ink-2")} aria-hidden>
        {team ? <Logo compact className="[&_svg]:size-6" /> : <UserRound className="size-4" />}
      </span>
      <div className={cn("max-w-[85%]", team && "text-right")}>
        <p className="mb-1 text-xs text-muted">
          <span className="font-medium text-ink-2">{name}</span> · <time>{time}</time>
          {aiAssisted && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-brand-600" title="Sent from an AI draft">
              <Sparkles className="size-3" aria-hidden /> AI-assisted
            </span>
          )}
        </p>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-left text-sm leading-relaxed whitespace-pre-wrap shadow-card",
            team ? "rounded-tr-sm bg-brand-700 text-white" : "rounded-tl-sm border border-line bg-surface text-ink",
          )}
        >
          {children}
        </div>
      </div>
    </li>
  );
}

/**
 * Admin view of the public conversation: author on the left, team on the
 * right. Internal notes live in their own panel, so this thread always
 * matches exactly what the author sees.
 */
export function AdminThread({ ticket, publicMessages }: { ticket: AdminTicketDetail; publicMessages: AdminMessage[] }) {
  const authorName = ticket.author?.name ?? "Author";
  return (
    <ol role="log" aria-live="polite" aria-label="Conversation with the author" className="space-y-6">
      <Bubble team={false} name={authorName} time={dateTime(ticket.createdAt)}>
        {ticket.description}
        {ticket.attachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
            {ticket.attachments.map((a) => (
              <li key={a.fileName} className="inline-flex items-center gap-1.5 rounded-md bg-paper-2 px-2 py-1 text-xs text-ink-2">
                <FileText className="size-3.5" aria-hidden />
                {a.fileName}
                {a.sizeBytes ? <span className="text-muted">· {fileSize(a.sizeBytes)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Bubble>
      {publicMessages.map((m) => (
        <Bubble
          key={m._id}
          team={m.senderRole === "admin"}
          name={m.senderRole === "admin" ? (m.senderName ?? "BookLeaf Support") : authorName}
          time={dateTime(m.createdAt)}
          aiAssisted={m.wasAiDrafted}
        >
          {m.body}
        </Bubble>
      ))}
    </ol>
  );
}
