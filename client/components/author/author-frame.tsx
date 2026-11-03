"use client";

import { BookOpen, LayoutDashboard, MessagesSquare, SquarePen } from "lucide-react";
import { RoleGate } from "@/components/auth/role-gate";
import { AppShell, type NavItem } from "@/components/layout/app-shell";
import { AuthorLiveProvider } from "./author-live";

const NAV: NavItem[] = [
  { href: "/author/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { href: "/author/books", label: "My books", icon: <BookOpen className="size-4" /> },
  { href: "/author/tickets", label: "My tickets", icon: <MessagesSquare className="size-4" />, matchPrefix: true, exclude: ["/author/tickets/new"] },
  { href: "/author/tickets/new", label: "Raise a ticket", icon: <SquarePen className="size-4" /> },
];

/** Guard, then the live stream, then the shell, for everything under /author. */
export function AuthorFrame({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate role="author">
      <AuthorLiveProvider>
        {(status) => (
          <AppShell nav={NAV} liveStatus={status}>
            {children}
          </AppShell>
        )}
      </AuthorLiveProvider>
    </RoleGate>
  );
}
