import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { FullPageLoader } from "@/components/ui/states";

// Auth is client-side (the session cookie belongs to the API's origin, so the
// server can't read it), and pages render only once the session is known.
// Navigation into this area waits on that check by design, so every page in
// it exports `instant = false`: the opt-out has to sit on the page segment
// itself, because ancestors don't exempt their children.

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<FullPageLoader label="Loading the admin console" />}>
      <AdminFrame>{children}</AdminFrame>
    </Suspense>
  );
}
