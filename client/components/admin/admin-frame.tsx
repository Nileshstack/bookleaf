"use client";

import { Inbox } from "lucide-react";
import { RoleGate } from "@/components/auth/role-gate";
import { AppShell, type NavItem } from "@/components/layout/app-shell";

const NAV: NavItem[] = [{ href: "/admin", label: "Ticket queue", icon: <Inbox className="size-4" />, matchPrefix: true }];

export function AdminFrame({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate role="admin">
      <AppShell nav={NAV}>{children}</AppShell>
    </RoleGate>
  );
}
