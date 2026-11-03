"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Info, RotateCcw, Sparkles, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type AdminTicketDetail,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/types";
import { AgeCell, ClassifyingShimmer, TriageSourceTag } from "./ticket-badges";

type Change = { status?: TicketStatus; category?: TicketCategory; priority?: TicketPriority };

function AiChip({ value }: { value: string }) {
  return (
    <Badge tone="brand" icon={<Sparkles className="size-3" aria-hidden />}>
      AI suggested: {value}
    </Badge>
  );
}

/**
 * Status, category, priority and assignment. Every change saves immediately.
 * Category and priority show the AI's suggestion next to the current value;
 * picking a different value is recorded as an override (for accuracy stats),
 * and "Use AI suggestion" reverts it.
 */
export function TriageControls({ ticket, onChange }: { ticket: AdminTicketDetail; onChange: (t: AdminTicketDetail) => void }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);

  const save = async (field: string, run: () => Promise<AdminTicketDetail>, success: string) => {
    setSaving(field);
    try {
      onChange(await run());
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save that change");
    } finally {
      setSaving(null);
    }
  };

  const update = (change: Change, success: string) =>
    save(Object.keys(change)[0], () => api.admin.update(ticket.ticketNumber, change), success);

  const pending = ticket.aiStatus === "pending";
  const mine = ticket.assignedTo?._id === user?._id;

  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-4">
        <h2 className="font-display text-base font-semibold text-ink">Ticket controls</h2>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          Age <AgeCell ageHours={ticket.ageHours} isOverdue={ticket.isOverdue} slaHours={ticket.slaHours} /> · target {ticket.slaHours}h · due{" "}
          {dateTime(ticket.dueAt)}
        </p>
      </div>

      <div className="space-y-1.5 px-5 py-4">
        <label htmlFor="ctl-status" className="text-sm font-medium text-ink">
          Status
        </label>
        <Select
          id="ctl-status"
          value={ticket.status}
          disabled={saving === "status"}
          onChange={(e) => update({ status: e.target.value as TicketStatus }, `Status set to ${e.target.value}`)}
        >
          {TICKET_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </div>

      <div className="space-y-2 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="ctl-category" className="text-sm font-medium text-ink">
            Category
          </label>
          <TriageSourceTag aiStatus={ticket.aiStatus} source={ticket.classificationSource} />
        </div>
        {pending ? (
          <ClassifyingShimmer />
        ) : (
          <>
            <Select
              id="ctl-category"
              value={ticket.category ?? ""}
              disabled={saving === "category"}
              onChange={(e) => update({ category: e.target.value as TicketCategory }, `Category set to ${e.target.value}`)}
            >
              {!ticket.category && <option value="">Unclassified</option>}
              {TICKET_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <div className="flex flex-wrap items-center gap-2">
              {ticket.aiCategory && <AiChip value={ticket.aiCategory} />}
              {ticket.categoryOverridden && ticket.aiCategory && (
                <>
                  <Badge tone="warning">Overridden</Badge>
                  <button
                    type="button"
                    onClick={() => update({ category: ticket.aiCategory as TicketCategory }, "Category reverted to the AI suggestion")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                  >
                    <RotateCcw className="size-3" aria-hidden /> Use AI suggestion
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 px-5 py-4">
        <div className="flex items-center gap-1.5">
          <label htmlFor="ctl-priority" className="text-sm font-medium text-ink">
            Priority
          </label>
          {ticket.aiReasoning && (
            <Tooltip
              label="Why this priority?"
              content={
                <>
                  <span className="mb-1 block font-semibold">
                    {ticket.classificationSource === "rules" ? "Rule-based fallback" : "AI reasoning"}
                    {ticket.aiConfidence !== null && ` · ${Math.round(ticket.aiConfidence * 100)}% confident`}
                  </span>
                  {ticket.aiReasoning}
                </>
              }
            >
              <Info className="size-3.5" aria-hidden />
            </Tooltip>
          )}
        </div>
        {pending ? (
          <ClassifyingShimmer />
        ) : (
          <>
            <Select
              id="ctl-priority"
              value={ticket.priority ?? ""}
              disabled={saving === "priority"}
              onChange={(e) => update({ priority: e.target.value as TicketPriority }, `Priority set to ${e.target.value}`)}
            >
              {!ticket.priority && <option value="">Unclassified</option>}
              {TICKET_PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <div className="flex flex-wrap items-center gap-2">
              {ticket.aiPriority && <AiChip value={ticket.aiPriority} />}
              {ticket.priorityOverridden && ticket.aiPriority && (
                <>
                  <Badge tone="warning">Overridden</Badge>
                  <button
                    type="button"
                    onClick={() => update({ priority: ticket.aiPriority as TicketPriority }, "Priority reverted to the AI suggestion")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                  >
                    <RotateCcw className="size-3" aria-hidden /> Use AI suggestion
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {ticket.aiStatus === "failed" && (
          <div className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
            <p>AI classification failed, so keyword rules set these values.</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              loading={saving === "classify"}
              onClick={() => save("classify", () => api.admin.classify(ticket.ticketNumber), "AI classification re-run")}
            >
              <Sparkles className="size-3.5" aria-hidden /> Retry AI
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Assignee</p>
          <p className="truncate text-sm text-ink-2">{ticket.assignedTo ? (mine ? "You" : ticket.assignedTo.name) : "Unassigned"}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={mine}
          loading={saving === "assign"}
          onClick={() => save("assign", () => api.admin.assignToMe(ticket.ticketNumber), "Assigned to you")}
        >
          <UserCheck className="size-4" aria-hidden /> {mine ? "Assigned to you" : "Assign to me"}
        </Button>
      </div>
    </Card>
  );
}
