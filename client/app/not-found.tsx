import { Compass } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Logo />
        <div className="mt-10 grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600" aria-hidden>
          <Compass className="size-5" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
        <ButtonLink href="/" className="mt-6">
          Go to my dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
