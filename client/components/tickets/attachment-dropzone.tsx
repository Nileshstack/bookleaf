"use client";

import { useId, useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { fileSize } from "@/lib/format";

/** Mirrors the API's attachment rules (server/src/models/enums.js). */
export const ATTACHMENT_RULES = {
  maxFiles: 5,
  maxSizeBytes: 10 * 1024 * 1024,
  mimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ],
  accept: ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt",
};

export interface PickedFile {
  key: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Drag-and-drop or browse. Files are validated and shown as chips; only
 * their metadata (name, size, type) is sent with the ticket.
 */
export function AttachmentDropzone({
  files,
  onChange,
  error,
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  error?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const problems: string[] = [];
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= ATTACHMENT_RULES.maxFiles) {
        problems.push(`Only ${ATTACHMENT_RULES.maxFiles} files can be attached; "${file.name}" was skipped.`);
        continue;
      }
      if (!ATTACHMENT_RULES.mimeTypes.includes(file.type)) {
        problems.push(`"${file.name}" isn't a supported type (images, PDF, Word or text).`);
        continue;
      }
      if (file.size > ATTACHMENT_RULES.maxSizeBytes) {
        problems.push(`"${file.name}" is ${fileSize(file.size)}; the limit is 10 MB.`);
        continue;
      }
      if (next.some((f) => f.fileName === file.name && f.sizeBytes === file.size)) continue;
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}`, fileName: file.name, sizeBytes: file.size, mimeType: file.type });
    }
    setRejections(problems);
    onChange(next);
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20",
          dragging ? "border-brand-500 bg-brand-50" : error ? "border-danger-600/60 bg-danger-50/40" : "border-line-strong bg-paper/60 hover:bg-paper-2/60",
        )}
      >
        <UploadCloud className={cn("size-7", dragging ? "text-brand-600" : "text-muted")} aria-hidden />
        <span className="mt-2 text-sm font-medium text-ink">
          Drag files here or <span className="text-brand-700 underline underline-offset-2">browse</span>
        </span>
        <span className="mt-1 text-xs text-muted">Photos, PDF, Word or text · up to 5 files · 10 MB each</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ATTACHMENT_RULES.accept}
          className="sr-only"
          onChange={(e) => add(e.target.files)}
        />
      </label>

      {(rejections.length > 0 || error) && (
        <ul role="alert" className="mt-2 space-y-1 text-xs font-medium text-danger-600">
          {error && <li>{error}</li>}
          {rejections.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.key} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-1.5 pl-2.5 text-sm shadow-card">
              {f.mimeType.startsWith("image/") ? (
                <ImageIcon className="size-4 shrink-0 text-brand-600" aria-hidden />
              ) : (
                <FileText className="size-4 shrink-0 text-brand-600" aria-hidden />
              )}
              <span className="max-w-[14rem] truncate text-ink">{f.fileName}</span>
              <span className="text-xs text-muted">{fileSize(f.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((x) => x.key !== f.key))}
                className="grid size-6 place-items-center rounded-md text-muted hover:bg-paper-2 hover:text-ink"
                aria-label={`Remove ${f.fileName}`}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <Paperclip className="size-3.5" aria-hidden />
        We list your files with the ticket. If we need the files themselves, we&apos;ll ask in the reply.
      </p>
    </div>
  );
}
