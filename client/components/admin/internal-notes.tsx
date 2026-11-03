"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EyeOff, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { AdminMessage } from "@/lib/types";

/** Team-only notes, tinted yellow and labelled so nobody mistakes them for a reply. */
export function InternalNotes({ ticketNumber, notes, onAdded }: { ticketNumber: string; notes: AdminMessage[]; onAdded: (note: AdminMessage) => void }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      onAdded(await api.admin.addNote(ticketNumber, body.trim()));
      setBody("");
      toast.success("Internal note added");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add the note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="notes-heading" className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50/70 shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-amber-200 px-5 py-3">
        <h2 id="notes-heading" className="inline-flex items-center gap-2 font-display text-base font-semibold text-amber-950">
          <StickyNote className="size-4" aria-hidden /> Internal notes
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
          <EyeOff className="size-3" aria-hidden /> Not visible to author
        </span>
      </div>

      {notes.length > 0 ? (
        <ul className="max-h-72 space-y-3 overflow-y-auto px-5 py-4">
          {notes.map((n) => (
            <li key={n._id} className="text-sm">
              <p className="text-xs text-amber-900/85">
                <span className="font-medium text-amber-950">{n.senderName ?? "Team"}</span> · {dateTime(n.createdAt)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-amber-950">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-amber-900/85">No notes yet. Use notes for context the author shouldn&apos;t see.</p>
      )}

      <div className="space-y-2 border-t border-amber-200 px-5 py-4">
        <label htmlFor="note-body" className="sr-only">
          New internal note
        </label>
        <Textarea
          id="note-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
          }}
          placeholder="Add a note for the team…"
          className="min-h-20 border-amber-300 bg-white/80 focus:border-amber-500 focus:ring-amber-500/20"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-amber-900/85">Ctrl + Enter to add</span>
          <Button size="sm" variant="secondary" onClick={add} loading={saving} disabled={!body.trim()}>
            Add note
          </Button>
        </div>
      </div>
    </section>
  );
}
