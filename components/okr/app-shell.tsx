"use client";

import { useState } from "react";
import { Bell, Menu, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/okr/theme-toggle";
import type { Workspace } from "@/app/types";

const navItems = [
  { href: "#my-goals", label: "My Goals" },
  { href: "#team-manager", label: "Team & Manager" },
  { href: "#company-okrs", label: "Company OKRs" },
  { href: "#alignment", label: "Alignment" },
  { href: "#reports", label: "Reports" },
  { href: "#people", label: "People" },
  { href: "#data-ops", label: "Data & Ops" },
];

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

function UserBlock({ workspace, onSignOut }: { workspace: Workspace; onSignOut: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-foreground" aria-hidden="true">
        {initials(workspace.user.name)}
      </span>
      <div className="hidden min-w-32 lg:block">
        <p className="text-sm font-semibold text-sidebar-foreground">{workspace.user.name}</p>
        <p className="text-xs text-sidebar-muted">{workspace.user.email}</p>
      </div>
      <Badge className="bg-sidebar-accent text-sidebar-foreground">{workspace.company.role}</Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={onSignOut}
        className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        Sign out
      </Button>
    </div>
  );
}

export function AppShell({
  workspace,
  unreadCount,
  onSignOut,
  search,
  onSearchChange,
  children,
}: {
  workspace: Workspace;
  unreadCount: number;
  onSignOut: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-40 bg-sidebar text-sidebar-foreground shadow-pop">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button type="button" className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation menu">
              <Menu className="size-5" />
            </button>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-teal text-sm font-bold text-sidebar" aria-hidden="true">O</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{workspace.company.name}</p>
              <p className="truncate text-xs text-sidebar-muted">OKR workspace</p>
            </div>
          </div>
          <div className="hidden flex-1 lg:block">
            <nav aria-label="Primary navigation" className="flex items-center justify-center gap-1">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} className="rounded-md px-3 py-2 text-xs font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="relative grid size-8 place-items-center rounded-full hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring" aria-label={`${unreadCount} recent audit updates`}>
              <Bell className="size-4" />
              {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-brand-coral text-[10px] font-semibold text-white">{unreadCount}</span>}
            </button>
            <ThemeToggle />
            <UserBlock workspace={workspace} onSignOut={onSignOut} />
          </div>
        </div>
      </div>

      <div className="sticky top-[64px] z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search objectives and key results"
            aria-label="Search objectives and key results"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-md"
          />
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6">{children}</main>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-primary/70" onClick={() => setDrawerOpen(false)} aria-label="Close navigation menu" />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col gap-4 bg-sidebar p-4 text-sidebar-foreground">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Navigation</p>
              <button type="button" className="rounded-md p-1 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring" onClick={() => setDrawerOpen(false)} aria-label="Close navigation menu">
                <X className="size-5" />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="grid gap-1">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setDrawerOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-auto rounded-lg bg-sidebar-accent p-3">
              <p className="text-sm font-semibold">{workspace.user.name}</p>
              <p className="mb-3 text-xs text-sidebar-muted">{workspace.user.email}</p>
              <Button className="w-full bg-primary text-primary-foreground" onClick={onSignOut}>Sign out</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
