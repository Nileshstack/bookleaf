"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, History, PenLine, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CharCounter, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { firstName, relative } from "@/lib/format";
import type { AdminMessage, AdminTicketDetail, AiDraft, TicketStatus } from "@/lib/types";

const MAX = 5000;
const SECTION_LABEL: Record<string, string> = {
  company: "Company overview",
  royalty: "Royalty policy",
  isbn: "ISBN policy",
  metadata: "Metadata updates",
  printing: "Printing & quality",
  distribution: "Distribution",
  production: "Production stages",
};

/** Template gaps such as "[book title]"; drafts from the model never contain these. */
const PLACEHOLDER = /\[[^\]\n]{3,}\]/;

/** Where the text in the box came from. Decides wasAiDrafted when sending. */
type Origin = "ai" | "stale" | "template" | "manual";
type Phase = "loading" | "ready" | "unavailable" | "sent";

interface Fallback {
  template?: string;
  staleDraft?: { draftText: string; generatedAt: string } | null;
}

/**
 * The reply composer. An AI draft loads automatically when the ticket opens.
 * The AI is an assistant, never a blocker: the agent can write manually while
 * it loads, and an outage turns into a banner with a template while sending
 * keeps working.
 */
export function DraftPanel({
  ticket,
  onSent,
}: {
  ticket: AdminTicketDetail;
  onSent: (message: AdminMessage, status: TicketStatus) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [aiError, setAiError] = useState<ApiError | null>(null);
  const [text, setText] = useState("");
  const [origin, setOrigin] = useState<Origin>("manual");
  const [sending, setSending] = useState<"reply" | "resolve" | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const fallback = (aiError?.extra.fallback ?? null) as Fallback | null;
  const edited = origin === "ai" ? text !== draft?.draftText : text.trim().length > 0;
  const closed = ticket.status === "Closed";
  const name = firstName(ticket.author?.name) || "the author";

  const load = async (regenerate: boolean) => {
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    setPhase("loading");
    setAiError(null);
    setConfirmRegen(false);
    try {
      const d = await api.admin.draft(ticket.ticketNumber, { regenerate });
      if (own.signal.aborted) return;
      setDraft(d);
      setText(d.draftText);
      setOrigin("ai");
      setPhase("ready");
    } catch (err) {
      if (own.signal.aborted) return;
      setAiError(err instanceof ApiError ? err : new ApiError({ status: 0, code: "UNKNOWN_ERROR", message: "AI drafting failed" }));
      setPhase("unavailable");
    }
  };

  // Auto-load once per ticket. Re-showing the page (Activity) must not
  // overwrite text the agent has been editing.
  const autoLoad = useEffectEvent(() => load(false));
  useEffect(() => {
    if (loadedFor.current === ticket.ticketNumber) return;
    loadedFor.current = ticket.ticketNumber;
    autoLoad();
  }, [ticket.ticketNumber]);

  // Deliberately no abort on unmount. React (Strict Mode, and Activity when
  // Next.js hides the page) unmounts and remounts with state preserved, and
  // the guard above won't reload. An in-flight draft must still land, so
  // only a newer load() or "write manually" cancels one.

  useEffect(() => {
    if (!confirmRegen) return;
    const t = setTimeout(() => setConfirmRegen(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRegen]);

  const writeManually = () => {
    controller.current?.abort();
    setPhase(aiError ? "unavailable" : "ready");
    setText("");
    setOrigin("manual");
    setTimeout(() => textRef.current?.focus());
  };

  const insert = (value: string, from: Origin) => {
    setText(value);
    setOrigin(from);
    setTimeout(() => textRef.current?.focus());
  };

  const regenerate = () => {
    if (edited && !confirmRegen) return setConfirmRegen(true);
    load(true);
  };

  const send = async (resolve: boolean) => {
    const body = text.trim();
    if (!body || sending) return;
    // A template still holding "[book title]"-style gaps must not reach the author.
    if (origin === "template" && PLACEHOLDER.test(body)) {
      toast.error("Fill in or remove the [bracketed] parts of the template before sending.");
      textRef.current?.focus();
      return;
    }
    const status: TicketStatus | undefined = resolve ? "Resolved" : closed ? "In Progress" : undefined;
    setSending(resolve ? "resolve" : "reply");
    try {
      const result = await api.admin.reply(ticket.ticketNumber, {
        body,
        wasAiDrafted: origin === "ai" || origin === "stale",
        status,
      });
      onSent(result.message, result.ticket.status);
      setPhase("sent");
      setText("");
      setOrigin("manual");
      setDraft(null);
      toast.success(resolve ? `Reply sent and ${ticket.ticketNumber} marked Resolved` : `Reply sent to ${name}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The reply couldn't be sent. Your text is still here.");
    } finally {
      setSending(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="inline-flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Sparkles className="size-4 text-brand-600" aria-hidden /> Reply to {name}
          </h2>
          <p className="mt-0.5 text-xs text-muted" aria-live="polite">
            {phase === "loading" && "Drafting a reply from BookLeaf policy and this author's records…"}
            {phase === "ready" &&
              (origin === "ai" && draft
                ? `AI draft${draft.cached ? " (saved)" : ""} · ${relative(draft.generatedAt)} · based on ${draft.context.sections.map((s) => SECTION_LABEL[s] ?? s).join(", ")}${edited ? " · edited" : ""}`
                : origin === "template"
                  ? "Template inserted. Fill in the [bracketed] parts."
                  : origin === "stale"
                    ? "Last saved AI draft. It may predate the newest messages."
                    : "Writing manually")}
            {phase === "unavailable" &&
              (origin === "template"
                ? "AI drafting is unavailable. Template inserted: fill in the [bracketed] parts."
                : "AI drafting is unavailable. You can still reply.")}
            {phase === "sent" && "Reply sent. The author sees it instantly."}
          </p>
        </div>
        {phase !== "loading" && phase !== "sent" && (
          <Button variant="ghost" size="sm" onClick={regenerate} aria-live="polite">
            <RefreshCw className="size-3.5" aria-hidden />
            {confirmRegen ? "Replace your edits?" : draft ? "Regenerate" : "Try AI draft"}
          </Button>
        )}
      </div>

      <div className="space-y-4 p-5">
        {phase === "unavailable" && (
          <div role="status" className="rounded-xl border border-warning-600/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4" aria-hidden /> AI unavailable: write manually
            </p>
            <p className="mt-1 text-xs">
              {aiError?.message}
              {typeof aiError?.extra.reason === "string" ? ` (${aiError.extra.reason})` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {fallback?.template && (
                <Button size="sm" variant="secondary" onClick={() => insert(fallback.template as string, "template")}>
                  <FileText className="size-3.5" aria-hidden /> Insert template
                </Button>
              )}
              {fallback?.staleDraft && (
                <Button size="sm" variant="secondary" onClick={() => insert(fallback.staleDraft!.draftText, "stale")}>
                  <History className="size-3.5" aria-hidden /> Use last draft ({relative(fallback.staleDraft.generatedAt)})
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => load(false)}>
                <RefreshCw className="size-3.5" aria-hidden /> Try again
              </Button>
            </div>
          </div>
        )}

        {phase === "ready" && origin === "ai" && draft && draft.warnings.length > 0 && (
          <ul role="status" className="space-y-1 rounded-xl border border-warning-600/30 bg-warning-50 px-4 py-3 text-xs text-warning-700">
            {draft.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {w}
              </li>
            ))}
          </ul>
        )}

        {phase === "sent" ? (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-success-50 px-4 py-4 text-sm text-success-700 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4" aria-hidden /> Reply sent to {name}.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={writeManually}>
                <PenLine className="size-3.5" aria-hidden /> Write another reply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => load(false)}>
                <Sparkles className="size-3.5" aria-hidden /> Draft with AI
              </Button>
            </div>
          </div>
        ) : phase === "loading" ? (
          <div className="space-y-3" aria-hidden>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/4" />
            <button type="button" onClick={writeManually} className="pt-1 text-xs font-medium text-brand-700 hover:underline">
              Write manually instead
            </button>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="reply-body" className="sr-only">
                Reply to {name}
              </label>
              <Textarea
                ref={textRef}
                id="reply-body"
                rows={12}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (!e.target.value.trim()) setOrigin("manual");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send(e.shiftKey);
                  }
                }}
                placeholder={`Write your reply to ${name}…`}
                aria-describedby="reply-hints"
                className={cn("min-h-64 font-[inherit]", origin === "ai" && !edited && "bg-brand-50/30")}
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p id="reply-hints" className="text-xs text-muted">
                {closed ? "This ticket is closed. Sending will reopen it as In Progress. " : ""}
                Ctrl + Enter sends · Ctrl + Shift + Enter sends and resolves
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <CharCounter value={text.trim().length} max={MAX} />
                <Button variant="secondary" onClick={() => send(true)} loading={sending === "resolve"} disabled={!text.trim() || text.trim().length > MAX || Boolean(sending)}>
                  <CheckCircle2 className="size-4" aria-hidden /> Send &amp; mark Resolved
                </Button>
                <Button onClick={() => send(false)} loading={sending === "reply"} disabled={!text.trim() || text.trim().length > MAX || Boolean(sending)}>
                  {sending !== "reply" && <Send className="size-4" aria-hidden />} Send reply
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
