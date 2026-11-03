"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { FullPageLoader } from "@/components/ui/states";
import { HOME_BY_ROLE, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

/**
 * Client-side guard for a whole area (/author, /admin).
 *
 * Why not proxy/middleware: the session cookie belongs to the API's origin,
 * which in production is a different site from this app, so Next.js can't
 * read it on the server. The API enforces auth on every request anyway; this
 * guard is about UX: redirect to login, or to the right portal for the role.
 */
export function RoleGate({ role, children }: { role: Role; children: React.ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === "authenticated" && user && user.role !== role) router.replace(HOME_BY_ROLE[user.role]);
  }, [status, user, role, router, pathname]);

  if (status !== "authenticated" || user?.role !== role) {
    return <FullPageLoader label={status === "anonymous" ? "Redirecting to sign in" : "Checking your session"} />;
  }
  return <>{children}</>;
}
