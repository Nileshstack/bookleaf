"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { SSEStatus } from "@/lib/useSSE";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Highlight for nested routes too (e.g. /author/tickets/123). */
  matchPrefix?: boolean;
  /** Exact paths that should not highlight this item even if prefixed. */
  exclude?: string[];
}

const isActive = (pathname: string, item: NavItem) =>
  !item.exclude?.includes(pathname) && (pathname === item.href || (item.matchPrefix && pathname.startsWith(`${item.href}/`)));

function LiveIndicator({ status }: { status: SSEStatus }) {
  const live = status === "open";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={live ? "Updates arrive instantly" : "Reconnecting to live updates"}>
      <span className={cn("size-2 rounded-full", live ? "bg-success-600" : "animate-pulse bg-warning-600")} aria-hidden />
      {live ? "Live" : "Reconnecting"}
      <span className="sr-only">{live ? ": live updates connected" : ": live updates reconnecting"}</span>
    </span>
  );
}

function NavLinks({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onNavigate={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-700 text-white shadow-sm" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              )}
            >
              <span className={cn("size-4", active ? "text-brand-100" : "text-muted")} aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Sidebar on desktop, top bar with a menu on mobile, and a skip link for keyboard users. */
export function AppShell({ nav, liveStatus, children }: { nav: NavItem[]; liveStatus?: SSEStatus; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // A transient menu shouldn't still be open when a hidden page is shown again.
  useLayoutEffect(() => () => setMenuOpen(false), []);

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  const userCard = (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 font-display text-sm font-semibold text-brand-800" aria-hidden>
        {user?.name
          ?.split(/\s+/)
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
        <p className="truncate text-xs text-muted">{user?.email}</p>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-paper-2 hover:text-ink"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-surface/70 backdrop-blur lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex-1 px-3">
          <NavLinks items={nav} pathname={pathname} />
        </nav>
        <div className="space-y-3 border-t border-line p-4">
          {liveStatus && <LiveIndicator status={liveStatus} />}
          {userCard}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-3">
            {liveStatus && <LiveIndicator status={liveStatus} />}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" aria-label="Main" className="animate-fade-in space-y-4 border-t border-line px-4 py-4">
            <NavLinks items={nav} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            <div className="border-t border-line pt-4">{userCard}</div>
          </nav>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
