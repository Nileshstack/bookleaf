"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Accessible tooltip: shows on hover and on keyboard focus, is announced via
 * aria-describedby, and closes with Escape. The trigger must be focusable
 * (a button is rendered for you).
 */
export function Tooltip({
  content,
  children,
  label,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Accessible name for the trigger button. */
  label: string;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={cn("inline-flex items-center rounded text-muted hover:text-ink", className)}
      >
        {children}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute left-1/2 z-40 w-max max-w-72 -translate-x-1/2 animate-fade-in rounded-lg bg-ink px-3 py-2 text-left text-xs leading-relaxed font-normal text-white shadow-pop",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
