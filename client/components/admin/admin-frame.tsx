"use client";

import { Inbox, LayoutDashboard } from "lucide-react";
import { RoleGate } from "@/components/auth/role-gate";
import { AppShell, type NavItem } from "@/components/layout/app-shell";
import { AdminLiveProvider } from "./admin-live";

/** Guard, then the admin live stream, then the shell, for everything under /admin. */
export function AdminFrame({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate role="admin">
      <AdminLiveProvider>
        {({ status, unseenCount }) => {
          const nav: NavItem[] = [
            { href: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
            { href: "/admin/tickets", label: "Ticket queue", icon: <Inbox className="size-4" />, matchPrefix: true, badge: unseenCount },
          ];
          return (
            <AppShell nav={nav} liveStatus={status}>
              {children}
            </AppShell>
          );
        }}
      </AdminLiveProvider>
    </RoleGate>
  );
}
