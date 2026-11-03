import { Suspense } from "react";
import { AuthorFrame } from "@/components/author/author-frame";
import { FullPageLoader } from "@/components/ui/states";

// The shell reads the pathname, which suspends under dynamic routes such as
// /author/tickets/[id] with Cache Components, so it sits inside Suspense.
// Auth is client-side (the session cookie belongs to the API's origin, so the
// server can't read it), and pages render only once the session is known.
// Navigation into this area waits on that check by design, so every page in
// it exports `instant = false`: the opt-out has to sit on the page segment
// itself, because ancestors don't exempt their children.

export default function AuthorLayout({ children }: LayoutProps<"/author">) {
  return (
    <Suspense fallback={<FullPageLoader label="Loading your workspace" />}>
      <AuthorFrame>{children}</AuthorFrame>
    </Suspense>
  );
}
