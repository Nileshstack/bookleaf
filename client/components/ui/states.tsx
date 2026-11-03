import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import type { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600" aria-hidden>
        {icon}
      </div>
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "We couldn't load this",
  className,
}: {
  error: ApiError | null;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const offline = error?.code === "NETWORK_ERROR";
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-danger-50 text-danger-600" aria-hidden>
        {offline ? <WifiOff className="size-5" /> : <AlertTriangle className="size-5" />}
      </div>
      <h3 className="font-display text-lg font-semibold text-ink">{offline ? "You seem to be offline" : title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{error?.message ?? "Something went wrong. Please try again."}</p>
      {error?.requestId && <p className="mt-2 font-mono text-xs text-muted">Reference: {error.requestId}</p>}
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center bg-paper">
      <div className="flex flex-col items-center gap-3 text-muted">
        <span className="size-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden />
        <span className="text-sm">{label}…</span>
      </div>
    </div>
  );
}
