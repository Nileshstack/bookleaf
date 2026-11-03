import { CheckCircle2, CircleDot, Clock3, Lock } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import type { TicketStatus } from "@/lib/types";

const STATUS: Record<TicketStatus, { tone: Tone; icon: React.ReactNode; hint: string }> = {
  Open: { tone: "info", icon: <CircleDot className="size-3" aria-hidden />, hint: "Waiting for our team" },
  "In Progress": { tone: "warning", icon: <Clock3 className="size-3" aria-hidden />, hint: "Our team is working on it" },
  Resolved: { tone: "success", icon: <CheckCircle2 className="size-3" aria-hidden />, hint: "Reply to reopen if it isn't fixed" },
  Closed: { tone: "neutral", icon: <Lock className="size-3" aria-hidden />, hint: "This ticket is closed" },
};

/** Colour plus icon plus text, so status never depends on colour alone. */
export function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      <span title={s.hint}>{status}</span>
    </Badge>
  );
}

export const statusHint = (status: TicketStatus) => STATUS[status].hint;
