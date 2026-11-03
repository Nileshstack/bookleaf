import { AlarmClock, Bot, Sparkles, Wrench } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ageLabel } from "@/lib/format";
import type { AiStatus, TicketPriority } from "@/lib/types";

/** Critical red, High orange, Medium yellow, Low gray. */
export const PRIORITY_TONE: Record<TicketPriority, Tone> = { Critical: "danger", High: "orange", Medium: "yellow", Low: "neutral" };
export const PRIORITY_FILL: Record<string, string> = {
  Critical: "#b4372f",
  High: "#ea580c",
  Medium: "#ca8a04",
  Low: "#94a3b8",
  Unclassified: "#d6ccbb",
};

export function PriorityBadge({ priority }: { priority: TicketPriority | null }) {
  if (!priority) return <Badge tone="neutral">Unclassified</Badge>;
  return <Badge tone={PRIORITY_TONE[priority]}>{priority}</Badge>;
}

export function CategoryBadge({ category }: { category: string | null }) {
  return category ? <Badge tone="brand">{category}</Badge> : <Badge tone="neutral">Unclassified</Badge>;
}

/** Shimmering placeholder while the AI is still classifying a ticket. */
export function ClassifyingShimmer({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center gap-1 overflow-hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 ring-inset",
        className,
      )}
    >
      <Sparkles className="size-3 animate-pulse" aria-hidden />
      AI classifying…
      <span
        className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent"
        aria-hidden
      />
    </span>
  );
}

/** "Rule-based" tag when the AI failed and keyword rules classified the ticket. */
export function TriageSourceTag({ aiStatus, source }: { aiStatus: AiStatus; source: "ai" | "rules" | null }) {
  if (aiStatus === "failed" || source === "rules") {
    return (
      <Badge tone="warning" icon={<Wrench className="size-3" aria-hidden />}>
        <span title="AI was unavailable, so keyword rules classified this ticket. Please double-check.">Rule-based fallback</span>
      </Badge>
    );
  }
  if (source === "ai") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted" title="Classified by AI">
        <Bot className="size-3" aria-hidden /> AI
      </span>
    );
  }
  return null;
}

/** Age with an overdue marker (icon plus text, not colour alone). */
export function AgeCell({ ageHours, isOverdue, slaHours }: { ageHours: number; isOverdue: boolean; slaHours: number }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 tabular-nums", isOverdue ? "font-semibold text-danger-700" : "text-ink-2")}
      title={isOverdue ? `Overdue: past the ${slaHours}h response target` : `Response target ${slaHours}h`}
    >
      {isOverdue && <AlarmClock className="size-3.5" aria-hidden />}
      {ageLabel(ageHours)}
      {isOverdue && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}
