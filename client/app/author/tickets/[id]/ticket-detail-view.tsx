"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, FileText, Info, Lock, Send, Tag, UserRound } from "lucide-react";
import { useAuthorLive } from "@/components/author/author-live";
import { Logo } from "@/components/brand/logo";
import { StatusBadge, statusHint } from "@/components/tickets/status-badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CharCounter, Textarea } from "@/components/ui/field";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { date, dateTime, fileSize } from "@/lib/format";
import type { Attachment, Message, TicketDetail } from "@/lib/types";
import { useResource } from "@/lib/useResource";

const MAX_REPLY = 5000;

export function TicketDetailSkeleton() {
  return (
    <LoadingRegion label="Loading ticket">
      <Skeleton className="mb-6 h-4 w-28" />
      <Skeleton className="mb-3 h-8 w-2/3" />
      <Skeleton className="mb-8 h-4 w-1/3" />
      <Card className="space-y-6 p-6">
        <Skeleton className="ml-auto h-24 w-3/4 rounded-2xl" />
        <Skeleton className="h-28 w-3/4 rounded-2xl" />
        <Skeleton className="h-24 w-full" />
      </Card>
    </LoadingRegion>
  );
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.fileName} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-1 text-xs">
          <FileText className="size-3.5" aria-hidden />
          {a.fileName}
          {a.sizeBytes ? <span className="opacity-75">· {fileSize(a.sizeBytes)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Author messages on the right in brand teal; BookLeaf replies on the left. */
function Bubble({ mine, name, time, children }: { mine: boolean; name: string; time: string; children: React.ReactNode }) {
  return (
    <li className={cn("flex animate-fade-in gap-3", mine && "flex-row-reverse")}>
      <span
        className={cn("mt-1 grid size-8 shrink-0 place-items-center rounded-full", mine ? "bg-brand-100 text-brand-800" : "bg-surface ring-1 ring-line")}
        aria-hidden
      >
        {mine ? <UserRound className="size-4" /> : <Logo compact className="[&_svg]:size-6" />}
      </span>
      <div className={cn("max-w-[85%] sm:max-w-[75%]", mine && "text-right")}>
        <p className="mb-1 text-xs text-muted">
          <span className="font-medium text-ink-2">{name}</span> · <time>{time}</time>
        </p>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-left text-sm leading-relaxed whitespace-pre-wrap shadow-card",
            mine ? "rounded-tr-sm bg-brand-700 text-white" : "rounded-tl-sm border border-line bg-surface text-ink",
          )}
        >
          {children}
        </div>
      </div>
    </li>
  );
}

export function TicketDetailView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const ticket = useResource((signal) => api.tickets.get(id, signal), [id]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messageCount = ticket.data?.messages.length ?? 0;

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    if (messageCount) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messageCount]);

  const appendMessage = (message: Message, status?: TicketDetail["status"]) =>
    ticket.mutate((current) =>
      current && !current.messages.some((m) => m._id === message._id)
        ? { ...current, status: status ?? current.status, messages: [...current.messages, message] }
        : current,
    );

  // Live: a new team reply appears without a refresh (the layout shows the toast).
  useAuthorLive((event) => {
    if (event.type === "resync") return ticket.reload({ silent: true });
    if (event.data.ticket.ticketNumber !== ticket.data?.ticketNumber) return;
    if (event.type === "admin_reply") appendMessage(event.data.message, event.data.ticket.status);
    if (event.type === "status_changed") ticket.mutate((c) => (c ? { ...c, status: event.data.ticket.status } : c));
  });

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = reply.trim();
    if (!body) return setReplyError("Write a message before sending");
    if (body.length > MAX_REPLY) return setReplyError(`Keep your message under ${MAX_REPLY.toLocaleString()} characters`);
    setSending(true);
    setReplyError(null);
    try {
      const result = await api.tickets.reply(id, body);
      appendMessage(result.message, result.ticket.status);
      setReply("");
      if (result.ticket.reopened) toast.info("Ticket reopened", { description: "Thanks for letting us know. Our team will take another look." });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "We couldn't send your message. Please try again.";
      setReplyError(message);
      if (err instanceof ApiError && err.code === "TICKET_CLOSED") ticket.reload({ silent: true });
    } finally {
      setSending(false);
    }
  };

  if (ticket.loading) return <TicketDetailSkeleton />;
  if (ticket.error || !ticket.data) {
    const notFound = ticket.error?.status === 404;
    return (
      <Card>
        <ErrorState
          error={notFound ? new ApiError({ status: 404, code: "NOT_FOUND", message: "This ticket doesn't exist, or it isn't on your account." }) : ticket.error}
          title={notFound ? "Ticket not found" : "We couldn't load this ticket"}
          onRetry={notFound ? undefined : () => ticket.reload()}
        />
        <div className="pb-8 text-center">
          <ButtonLink href="/author/tickets" variant="secondary">
            Back to my tickets
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const t = ticket.data;
  const closed = t.status === "Closed";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/author/tickets" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All tickets
      </Link>

      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-paper-2 px-2 py-0.5 font-mono text-xs text-ink-2">{t.ticketNumber}</span>
          <StatusBadge status={t.status} />
        </div>
        <h1 className="font-display text-2xl leading-tight font-semibold text-ink sm:text-3xl">{t.subject}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            {t.book ? <BookOpen className="size-4" aria-hidden /> : <UserRound className="size-4" aria-hidden />}
            {t.book ? t.book.title : "General / Account level"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Tag className="size-4" aria-hidden />
            {t.category ?? "Being reviewed"}
          </span>
          <span>Opened {date(t.createdAt)}</span>
        </p>
        <p className="sr-only" aria-live="polite">
          Status: {t.status}. {statusHint(t.status)}
        </p>
      </header>

      <Card className="p-4 sm:p-6">
        <div role="log" aria-live="polite" aria-label="Conversation">
          <ol className="space-y-6">
            <Bubble mine name="You" time={dateTime(t.createdAt)}>
              {t.description}
              <AttachmentList attachments={t.attachments} />
            </Bubble>

            {t.messages.map((m) => (
              <Bubble key={m._id} mine={m.senderRole === "author"} name={m.senderRole === "author" ? "You" : (m.senderName ?? "BookLeaf Support")} time={dateTime(m.createdAt)}>
                {m.body}
              </Bubble>
            ))}

            {t.messages.every((m) => m.senderRole === "author") && !closed && (
              <li className="flex items-center gap-2 rounded-lg bg-paper-2/70 px-3 py-2.5 text-sm text-ink-2">
                <Info className="size-4 shrink-0 text-muted" aria-hidden />
                Our support team has your ticket. Their reply will appear here as soon as it&apos;s sent.
              </li>
            )}
          </ol>
        </div>
        <div ref={endRef} />

        <div className="mt-6 border-t border-line pt-5">
          {closed ? (
            <div className="flex flex-col items-start gap-3 rounded-xl bg-paper-2/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Lock className="size-4 text-muted" aria-hidden /> This ticket is closed, so it can&apos;t receive new replies.
              </p>
              <ButtonLink href={`/author/tickets/new${t.book ? `?bookId=${t.book.bookId}` : ""}`} size="sm">
                Open a new ticket
              </ButtonLink>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-3">
              <label htmlFor="reply" className="text-sm font-medium text-ink">
                Reply to the BookLeaf team
              </label>
              <Textarea
                id="reply"
                rows={4}
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (replyError) setReplyError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                placeholder="Add details or ask a follow-up question…"
                aria-describedby="reply-help"
                invalid={Boolean(replyError)}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p id="reply-help" className={cn("text-xs", replyError ? "font-medium text-danger-600" : "text-muted")} role={replyError ? "alert" : undefined}>
                  {replyError ??
                    (t.status === "Resolved" ? "Sending a reply will reopen this ticket." : "Press Ctrl + Enter to send.")}
                </p>
                <div className="flex items-center gap-3 self-end">
                  <CharCounter value={reply.trim().length} max={MAX_REPLY} />
                  <Button type="submit" loading={sending} disabled={!reply.trim()}>
                    {!sending && <Send className="size-4" aria-hidden />}
                    {sending ? "Sending" : "Send reply"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </Card>

      {user && (
        <p className="mt-4 text-center text-xs text-muted">
          Signed in as {user.email} · Replies are visible only to you and the BookLeaf team.
        </p>
      )}
    </div>
  );
}
