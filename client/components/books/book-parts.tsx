import { Check, CircleDashed, Clock, Info, PartyPopper, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { DASH, date, inr } from "@/lib/format";
import type { Book, ProductionProgress, RoyaltyBreakdown } from "@/lib/types";

export function BookStatusBadge({ book }: { book: Book }) {
  return book.isPublished ? (
    <Badge tone="success" icon={<Check className="size-3" aria-hidden />}>
      Published &amp; Live
    </Badge>
  ) : (
    <Badge tone="warning" icon={<Clock className="size-3" aria-hidden />}>
      In production
    </Badge>
  );
}

const PLATFORM_LABEL: Record<string, string> = {
  "Amazon India": "Amazon.in",
  "Amazon US": "Amazon.com",
  "Amazon UK": "Amazon.co.uk",
};

export function PlatformBadges({ platforms }: { platforms: string[] }) {
  if (!platforms.length) return <p className="text-sm text-muted">Not listed on any platform yet</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Available on">
      {platforms.map((p) => (
        <li key={p}>
          <Badge tone="brand">{PLATFORM_LABEL[p] ?? p}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** A figure, or an em dash with an explanation for screen readers. Never a fake zero. */
export function Figure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const missing = value === DASH;
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums", emphasis ? "font-display text-lg font-semibold text-ink" : "text-sm font-medium text-ink", missing && "text-muted")}>
        {value}
        {missing && <span className="sr-only">Not available until the book is published</span>}
      </dd>
    </div>
  );
}

/** Production pipeline as an ordered list: done, current, upcoming. */
export function ProductionStepper({ production }: { production: ProductionProgress }) {
  const current = production.stepNumber ? production.stepNumber - 1 : -1;
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          Currently in <span className="text-brand-700">{production.currentStage}</span>
        </p>
        {production.stepNumber && (
          <p className="text-xs text-muted tabular-nums">
            Step {production.stepNumber} of {production.totalSteps}
          </p>
        )}
      </div>
      <div className="mb-4 flex gap-1" aria-hidden>
        {production.stages.map((stage, i) => (
          <span key={stage} className={cn("h-1.5 flex-1 rounded-full", i < current ? "bg-brand-500" : i === current ? "bg-warning-600" : "bg-paper-2")} />
        ))}
      </div>
      <ol className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3" aria-label="Production stages">
        {production.stages.map((stage, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li
              key={stage}
              aria-current={state === "current" ? "step" : undefined}
              className={cn("flex items-center gap-1.5", state === "done" && "text-ink-2", state === "current" && "font-semibold text-warning-700", state === "upcoming" && "text-muted")}
            >
              {state === "done" ? (
                <Check className="size-3.5 text-brand-600" aria-hidden />
              ) : state === "current" ? (
                <Clock className="size-3.5" aria-hidden />
              ) : (
                <CircleDashed className="size-3.5" aria-hidden />
              )}
              {stage}
              <span className="sr-only">{state === "done" ? " (completed)" : state === "current" ? " (current stage)" : " (upcoming)"}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 flex gap-2 rounded-lg bg-paper-2/70 px-3 py-2.5 text-xs text-ink-2">
        <Info className="mt-px size-3.5 shrink-0 text-muted" aria-hidden />
        Price, sales and royalty figures appear once your book is published. We email you as it moves through each stage.
      </p>
    </div>
  );
}

/** The plain-language payout explanation under each published book's figures. */
export function PayoutNote({ royalty }: { royalty: RoyaltyBreakdown }) {
  const next = royalty.nextScheduledPayout ? date(royalty.nextScheduledPayout.payoutBy) : null;
  const threshold = inr(royalty.payoutThreshold);

  const note = (() => {
    switch (royalty.payoutStatus) {
      case "no_earnings_yet":
        return { icon: <Info />, tone: "neutral", text: "No copies sold yet. Royalties will show here as soon as your first sales come in." };
      case "fully_paid":
        return {
          icon: <PartyPopper />,
          tone: "success",
          text: `All royalties paid${royalty.lastPayoutDate ? `, most recently on ${date(royalty.lastPayoutDate)}` : ""}. Nothing is pending.`,
        };
      default:
        if (royalty.rollsOverToNextQuarter) {
          return {
            icon: <Info />,
            tone: "warning",
            text: `${inr(royalty.pending)} is below the ${threshold} minimum payout, so it rolls over to the next quarter and is paid once your balance reaches ${threshold}.`,
          };
        }
        return {
          icon: <Wallet />,
          tone: "brand",
          text: `${inr(royalty.pending)} is pending${royalty.payoutStatus === "awaiting_first_payout" ? ". This will be your first payout" : ""}. Royalties are calculated quarterly and paid within 45 days of the quarter ending${next ? `; the next payout deadline is ${next}` : ""}.`,
        };
    }
  })();

  const tones: Record<string, string> = {
    neutral: "bg-paper-2/70 text-ink-2",
    success: "bg-success-50 text-success-700",
    warning: "bg-warning-50 text-warning-700",
    brand: "bg-brand-50 text-brand-800",
  };

  return (
    <p className={cn("flex gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed", tones[note.tone])}>
      <span className="mt-px size-3.5 shrink-0 [&>svg]:size-3.5" aria-hidden>
        {note.icon}
      </span>
      {note.text}
    </p>
  );
}

/** Paid vs pending as a bar with a text equivalent. */
export function PaidBar({ royalty }: { royalty: RoyaltyBreakdown }) {
  if (royalty.paidPercentage === null) return null;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>Paid out</span>
        <span className="tabular-nums">{royalty.paidPercentage}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-warning-50"
        role="progressbar"
        aria-label="Share of royalty paid out"
        aria-valuenow={royalty.paidPercentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${royalty.paidPercentage}%` }} />
      </div>
    </div>
  );
}
