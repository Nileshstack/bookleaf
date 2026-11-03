"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Lightbulb, Send } from "lucide-react";
import { AttachmentDropzone, type PickedFile } from "@/components/tickets/attachment-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CharCounter, Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useResource";

const LIMITS = { subject: { min: 5, max: 200 }, description: { min: 20, max: 5000 } };
const GENERAL = "";

type Errors = Partial<Record<"bookId" | "subject" | "description" | "attachments" | "form", string>>;

/** The same rules the API enforces, checked before sending for instant feedback. */
const validate = (subject: string, description: string): Errors => {
  const e: Errors = {};
  const s = subject.trim();
  const d = description.trim();
  if (s.length < LIMITS.subject.min) e.subject = s ? `Add a little more detail (at least ${LIMITS.subject.min} characters)` : "Give your ticket a short subject";
  else if (s.length > LIMITS.subject.max) e.subject = `Keep the subject under ${LIMITS.subject.max} characters`;
  if (d.length < LIMITS.description.min)
    e.description = d ? `Please describe the issue in at least ${LIMITS.description.min} characters so we can help faster` : "Describe what's happening";
  else if (d.length > LIMITS.description.max) e.description = `Keep the description under ${LIMITS.description.max.toLocaleString()} characters`;
  return e;
};

export function NewTicketView() {
  const router = useRouter();
  const preselect = useSearchParams().get("bookId");
  const books = useResource((signal) => api.books.list(signal));

  const [bookChoice, setBookChoice] = useState<string | null>(null); // null = not touched yet
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // ?bookId=BK001 pre-selects that book, if it's one of the author's.
  const preselected = books.data?.find((b) => b.bookId === preselect)?.bookId ?? GENERAL;
  const bookId = bookChoice ?? preselected;

  const reset = () => {
    setBookChoice(null);
    setSubject("");
    setDescription("");
    setFiles([]);
    setErrors({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate(subject, description);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(Object.keys(found)[0])?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await api.tickets.create({
        bookId: bookId || null,
        subject: subject.trim(),
        description: description.trim(),
        attachments: files.map(({ fileName, sizeBytes, mimeType }) => ({ fileName, sizeBytes, mimeType })),
      });
      toast.success(`Ticket ${ticket.ticketNumber} created`, { description: "Our support team will reply here. You'll see it instantly." });
      // Next.js keeps this page mounted in the background, so clear it for the next ticket.
      reset();
      router.push(`/author/tickets/${ticket.ticketNumber}`);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      const fields = apiError?.fieldErrors() ?? {};
      const attachmentError = Object.entries(fields).find(([k]) => k.startsWith("attachments"))?.[1];
      setErrors({ ...fields, attachments: attachmentError, form: Object.keys(fields).length ? undefined : apiError?.message });
      if (!Object.keys(fields).length) toast.error(apiError?.message ?? "We couldn't create your ticket. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Raise a ticket" description="Tell us what's going on and our support team will get back to you here." />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form onSubmit={onSubmit} noValidate className="space-y-6 p-5 sm:p-6">
            <Field
              id="bookId"
              label="Which book is this about?"
              error={errors.bookId}
              hint={books.error ? "We couldn't load your books, but you can still send a general question." : "Choose a book, or General for account-level questions."}
            >
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  value={bookId}
                  onChange={(e) => setBookChoice(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  disabled={books.loading}
                >
                  <option value={GENERAL}>General / Account level</option>
                  {books.data?.map((b) => (
                    <option key={b._id} value={b.bookId}>
                      {b.title}
                      {b.isPublished ? "" : ` (in production: ${b.production.currentStage})`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="subject"
              label="Subject"
              required
              error={errors.subject}
              counter={<CharCounter value={subject.trim().length} max={LIMITS.subject.max} />}
              hint="A short summary, e.g. “Royalty for Q3 not received”"
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  value={subject}
                  maxLength={LIMITS.subject.max + 50}
                  onChange={(e) => setSubject(e.target.value)}
                  aria-describedby={describedBy}
                  aria-required
                  invalid={invalid}
                />
              )}
            </Field>

            <Field
              id="description"
              label="Description"
              required
              error={errors.description}
              counter={<CharCounter value={description.trim().length} min={LIMITS.description.min} max={LIMITS.description.max} />}
              hint="Include anything that helps: dates, amounts, platform names, order numbers."
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  rows={7}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-describedby={describedBy}
                  aria-required
                  invalid={invalid}
                />
              )}
            </Field>

            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">
                Attachments <span className="font-normal text-muted">(optional)</span>
              </p>
              <AttachmentDropzone files={files} onChange={setFiles} error={errors.attachments} />
            </div>

            {errors.form && (
              <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
                {errors.form}
              </p>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                {!submitting && <Send className="size-4" aria-hidden />}
                {submitting ? "Sending" : "Submit ticket"}
              </Button>
            </div>
          </form>
        </Card>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
              <Lightbulb className="size-4 text-warning-600" aria-hidden /> Tips for a faster answer
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              <li>Pick the book the question is about. We&apos;ll see its sales and royalty details right away.</li>
              <li>For print quality issues, mention how many copies are affected; we may ask for photos.</li>
              <li>For listings, name the platform (e.g. Amazon India, Flipkart).</li>
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
              <CheckCircle2 className="size-4 text-success-600" aria-hidden /> What happens next
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-ink-2">
              <li>Your ticket is routed to the right specialist automatically.</li>
              <li>Our team replies on the ticket page. You&apos;ll see replies instantly, no refresh needed.</li>
              <li>Reply any time to add details, even after it&apos;s resolved.</li>
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
