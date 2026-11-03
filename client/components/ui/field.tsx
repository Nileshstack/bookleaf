"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-paper-2";

const borderFor = (error?: string) => (error ? "border-danger-600" : "border-line-strong");

interface FieldProps {
  /** Fixed id for the control (e.g. to focus it after validation); generated if omitted. */
  id?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  counter?: React.ReactNode;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}

/** Label, control, hint and error, wired together with ids and aria attributes. */
export function Field({ id: idProp, label, hint, error, required, counter, className, children }: FieldProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {required && (
            <span className="text-danger-600" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
        {counter}
      </div>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, invalid, ...props }: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={cn(control, "h-10", borderFor(invalid ? "x" : undefined), className)} aria-invalid={invalid || undefined} {...props} />;
}

export function Textarea({ className, invalid, ...props }: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(control, "min-h-32 py-2.5 leading-relaxed", borderFor(invalid ? "x" : undefined), className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({ className, invalid, ...props }: React.ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select className={cn(control, "h-10 pr-8", borderFor(invalid ? "x" : undefined), className)} aria-invalid={invalid || undefined} {...props} />
  );
}

/** "123 / 5000" counter that turns amber near the limit and red past it. */
export function CharCounter({ value, min, max }: { value: number; min?: number; max: number }) {
  const tone = value > max ? "text-danger-600" : value > max * 0.9 ? "text-warning-600" : "text-muted";
  return (
    <span className={cn("text-xs tabular-nums", tone)} aria-live="polite">
      {min && value < min ? `${min - value} more needed · ` : ""}
      {value.toLocaleString()} / {max.toLocaleString()}
    </span>
  );
}
