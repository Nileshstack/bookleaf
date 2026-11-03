import { cn } from "@/lib/cn";

/** BookLeaf wordmark: an open-book leaf mark plus the name in the display serif. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-brand-700" />
        <path d="M16 23.5c-2.6-1.7-5.6-2.3-8.5-2V10c2.9-.3 5.9.3 8.5 2v11.5Z" className="fill-brand-200" />
        <path d="M16 23.5c2.6-1.7 5.6-2.3 8.5-2V10c-2.9-.3-5.9.3-8.5 2v11.5Z" className="fill-white" />
        <path d="M16 12v11.5" className="stroke-brand-700" strokeWidth="1.2" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="block font-display text-lg font-semibold tracking-tight text-ink">BookLeaf</span>
          <span className="block text-[11px] font-medium tracking-wide text-muted uppercase">Author Support</span>
        </span>
      )}
    </span>
  );
}
