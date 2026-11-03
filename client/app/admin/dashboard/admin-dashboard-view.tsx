"use client";

import Link from "next/link";
import { useState } from "react";
import { AlarmClock, ArrowRight, Bot, Flame, Hourglass, Inbox, Sparkles, UserX } from "lucide-react";
import { useAdminLive } from "@/components/admin/admin-live";
import { CategoryChart, PriorityChart } from "@/components/admin/charts";
import { AgeCell, PriorityBadge } from "@/components/admin/ticket-badges";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ageLabel, count, firstName, greeting, percent } from "@/lib/format";
import { useResource } from "@/lib/useResource";

function Stat({
  icon,
  label,
  value,
  sub,
  href,
  tone = "brand",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: React.ReactNode;
  href?: string;
  tone?: "brand" | "danger" | "warning";
}) {
  const iconTone = { brand: "bg-brand-50 text-brand-700", danger: "bg-danger-50 text-danger-600", warning: "bg-warning-50 text-warning-700" }[tone];
  const body = (
    <Card className={cn("h-full p-5", href && "transition-shadow hover:shadow-pop")}>
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className={cn("grid size-8 place-items-center rounded-lg [&>svg]:size-4", iconTone)} aria-hidden>
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-card)]">
      {body}
    </Link>
  ) : (
    body
  );
}

export function AdminDashboardView() {
  const { user } = useAuth();
  const stats = useResource((signal) => api.admin.stats(signal));
  const usage = useResource((signal) => api.admin.aiUsage(signal));
  const attention = useResource((signal) => api.admin.queue({ status: "Open,In Progress", limit: 5 }, signal));
  const [scope, setScope] = useState<"open" | "all">("open");

  // Any queue change can move the numbers; refresh quietly.
  useAdminLive(() => {
    stats.reload({ silent: true });
    attention.reload({ silent: true });
  });

  const s = stats.data;

  return (
    <>
      <PageHeader
        eyebrow={`${greeting()}${user?.name ? `, ${firstName(user.name)}` : ""}`}
        title="Support dashboard"
        description="The state of the support queue right now, and how the AI triage is performing."
        actions={
          <ButtonLink href="/admin/tickets">
            <Inbox className="size-4" aria-hidden /> Open the queue
          </ButtonLink>
        }
      />

      {stats.loading ? (
        <LoadingRegion label="Loading dashboard">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Card key={i} className="space-y-3 p-5">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-9 w-16" />
                <Skeleton className="h-3 w-32" />
              </Card>
            ))}
          </div>
        </LoadingRegion>
      ) : stats.error || !s ? (
        <Card>
          <ErrorState error={stats.error} onRetry={() => stats.reload()} title="We couldn't load the dashboard" />
        </Card>
      ) : (
        <>
          <section aria-label="Queue summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat
              icon={<Inbox />}
              label="Open tickets"
              value={count(s.unresolved.count)}
              sub={`${s.byStatus.Open} open · ${s.byStatus["In Progress"]} in progress`}
              href="/admin/tickets"
            />
            <Stat
              icon={<Flame />}
              tone="danger"
              label="Critical"
              value={count(s.unresolved.byPriority.Critical)}
              sub="Open tickets marked Critical"
              href="/admin/tickets?priority=Critical"
            />
            <Stat
              icon={<AlarmClock />}
              tone={s.unresolved.overdue ? "danger" : "brand"}
              label="Overdue"
              value={count(s.unresolved.overdue)}
              sub="Past their response target"
              href="/admin/tickets?overdue=true"
            />
            <Stat
              icon={<Hourglass />}
              tone="warning"
              label="Average age"
              value={s.unresolved.averageAgeHours === null ? "—" : ageLabel(s.unresolved.averageAgeHours)}
              sub={`${s.unresolved.unassigned} unassigned`}
            />
            <Stat
              icon={<Bot />}
              label="AI override rate"
              value={percent(s.ai.category.overrideRate)}
              sub={
                s.ai.category.suggested
                  ? `${s.ai.category.overridden} of ${s.ai.category.suggested} categories · priority ${percent(s.ai.priority.overrideRate)}`
                  : "No AI classifications yet"
              }
            />
          </section>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Tickets by category and priority"
                description={scope === "open" ? `${s.unresolved.count} open tickets` : `${s.total} tickets in total`}
                action={
                  <div role="group" aria-label="Chart scope" className="inline-flex rounded-lg border border-line p-0.5 text-xs">
                    {(["open", "all"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={scope === v}
                        onClick={() => setScope(v)}
                        className={cn("rounded-md px-2.5 py-1 font-medium", scope === v ? "bg-brand-700 text-white" : "text-ink-2 hover:bg-paper-2")}
                      >
                        {v === "open" ? "Open" : "All time"}
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="grid gap-6 p-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-medium text-ink-2">By category</h3>
                  <CategoryChart counts={scope === "open" ? s.unresolved.byCategory : s.byCategory} caption="Tickets by category" />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium text-ink-2">By priority</h3>
                  <PriorityChart counts={scope === "open" ? s.unresolved.byPriority : s.byPriority} caption="Tickets by priority" />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="AI assistance" description="Triage and drafting across all tickets; cost over 30 days" />
              <dl className="divide-y divide-line text-sm">
                {[
                  ["Classified by AI", count(s.ai.classification.done)],
                  ["Rule-based fallback", count(s.ai.classification.failed)],
                  ["Waiting for AI", count(s.ai.classification.pending)],
                  ["Replies started from an AI draft", `${percent(s.ai.drafts.adoptionRate)} of ${s.ai.drafts.repliesSent}`],
                  [
                    "AI cost (30 days)",
                    usage.data ? `$${usage.data.totals.costUsd.toFixed(4)} · ${usage.data.totals.calls} calls` : usage.error ? "Unavailable" : "…",
                  ],
                  [
                    "AI service",
                    usage.data ? (!usage.data.client.enabled ? "Not configured" : usage.data.client.circuit === "open" ? "Paused (recovering)" : "Healthy") : "…",
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-medium text-ink tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Needs attention"
          description="Most urgent, then oldest, of the open tickets"
          action={
            <Link href="/admin/tickets" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Full queue <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        />
        {attention.loading ? (
          <div className="space-y-3 p-5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : attention.error ? (
          <ErrorState error={attention.error} onRetry={() => attention.reload()} />
        ) : !attention.data?.items.length ? (
          <EmptyState icon={<Sparkles className="size-5" />} title="Inbox zero" description="No open tickets right now. Nice work." />
        ) : (
          <ul className="divide-y divide-line">
            {attention.data.items.map((t) => (
              <li key={t._id}>
                <Link
                  href={`/admin/tickets/${t.ticketNumber}`}
                  className={cn("flex items-center gap-4 px-5 py-3 hover:bg-paper-2/50", t.isOverdue && "bg-danger-50/40")}
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-muted">{t.ticketNumber}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{t.subject}</span>
                    <span className="block truncate text-xs text-muted">{t.author?.name}</span>
                  </span>
                  <PriorityBadge priority={t.priority} />
                  <span className="w-16 text-right text-sm">
                    <AgeCell ageHours={t.ageHours} isOverdue={t.isOverdue} slaHours={t.slaHours} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {s && s.unresolved.unassigned > 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <UserX className="size-4" aria-hidden /> {s.unresolved.unassigned} open tickets have no owner yet.{" "}
          <Link href="/admin/tickets?assignedTo=unassigned" className="font-medium text-brand-700 hover:underline">
            Show them
          </Link>
        </p>
      )}
    </>
  );
}
