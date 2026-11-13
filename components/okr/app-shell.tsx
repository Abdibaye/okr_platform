"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  CalendarRange,
  ChevronsLeft,
  ChevronsRight,
  GitCompareArrows,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Target,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/okr/theme-toggle";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/app/types";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  managersOnly?: boolean;
}

const navItems: NavItem[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "my-goals", label: "Objectives & key results", icon: Target },
  { id: "company-okrs", label: "Cycles", icon: CalendarRange },
  { id: "alignment", label: "Period comparison", icon: GitCompareArrows },
  { id: "reports", label: "Audit log", icon: ScrollText },
  { id: "people", label: "People", icon: Users, managersOnly: true },
];

const SIDEBAR_KEY = "okr-sidebar-expanded";

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

const itemClass =
  "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function SidebarTip({ show, label, children }: { show: boolean; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {show && <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>}
    </Tooltip>
  );
}

function NavList({ items, active, expanded, onNavigate }: {
  items: NavItem[];
  active: string;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="grid gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <li key={item.id}>
            <SidebarTip show={!expanded} label={item.label}>
              <a
                href={`#${item.id}`}
                onClick={onNavigate}
                aria-label={item.label}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  itemClass,
                  !expanded && "justify-center px-0",
                  isActive && "bg-brand-teal text-sidebar hover:bg-brand-teal hover:text-sidebar",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {expanded && <span className="truncate">{item.label}</span>}
              </a>
            </SidebarTip>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarFooter({ workspace, unreadCount, expanded, onSignOut, onNavigate }: {
  workspace: Workspace;
  unreadCount: number;
  expanded: boolean;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const profileLabel = `${workspace.user.name} · ${workspace.user.email} · ${workspace.company.role}`;
  return (
    <div className="grid gap-1 border-t border-sidebar-border pt-3">
      <SidebarTip show={!expanded} label={`${unreadCount} recent audit updates`}>
        <a href="#reports" onClick={onNavigate} aria-label={`${unreadCount} recent audit updates`} className={cn(itemClass, !expanded && "justify-center px-0")}>
          <span className="relative">
            <Bell className="size-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-brand-coral px-1 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </span>
          {expanded && <span>Recent updates</span>}
        </a>
      </SidebarTip>
      <div className={cn("flex items-center", expanded ? "gap-3 px-1.5" : "justify-center")}>
        <ThemeToggle />
        {expanded && <span className="text-sm text-sidebar-muted">Theme</span>}
      </div>
      <SidebarTip show={!expanded} label={profileLabel}>
        <div
          tabIndex={expanded ? undefined : 0}
          aria-label={expanded ? undefined : profileLabel}
          className={cn("flex items-center gap-3 rounded-lg py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", expanded ? "px-1.5" : "justify-center")}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-foreground" aria-hidden="true">
            {initials(workspace.user.name)}
          </span>
          {expanded && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">{workspace.user.name}</span>
              <span className="block truncate text-xs capitalize text-sidebar-muted">{workspace.company.role} · {workspace.company.name}</span>
            </span>
          )}
        </div>
      </SidebarTip>
      <SidebarTip show={!expanded} label="Sign out">
        <button type="button" onClick={onSignOut} aria-label="Sign out" className={cn(itemClass, !expanded && "justify-center px-0")}>
          <LogOut className="size-5" aria-hidden="true" />
          {expanded && <span>Sign out</span>}
        </button>
      </SidebarTip>
    </div>
  );
}

function Logo() {
  return <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-teal text-sm font-bold text-sidebar" aria-hidden="true">O</span>;
}

export function AppShell({
  workspace,
  unreadCount,
  onSignOut,
  children,
}: {
  workspace: Workspace;
  unreadCount: number;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState("overview");
  const canManage = workspace.company.role !== "member";
  const items = navItems.filter((item) => canManage || !item.managersOnly);

  useEffect(() => {
    setExpanded(window.localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

  useEffect(() => {
    const sections = navItems
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-20% 0px -60% 0px" });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [canManage]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function toggleExpanded() {
    setExpanded((current) => {
      window.localStorage.setItem(SIDEBAR_KEY, current ? "0" : "1");
      return !current;
    });
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh bg-background">
        <aside
          aria-label="Sidebar"
          className={cn(
            "fixed inset-y-0 left-0 z-40 hidden flex-col bg-sidebar px-3 py-4 text-sidebar-foreground transition-[width] duration-200 md:flex",
            expanded ? "w-60" : "w-[4.5rem]",
          )}
        >
          <div className={cn("mb-6 flex items-center gap-3", !expanded && "justify-center")}>
            <Logo />
            {expanded && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{workspace.company.name}</span>
                <span className="block truncate text-xs text-sidebar-muted">OKR workspace</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={toggleExpanded}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={expanded}
            className="absolute -right-3 top-16 grid size-6 place-items-center rounded-md bg-brand-teal text-sidebar shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
          </button>
          <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto">
            <NavList items={items} active={active} expanded={expanded} />
          </nav>
          <SidebarFooter workspace={workspace} unreadCount={unreadCount} expanded={expanded} onSignOut={onSignOut} />
        </aside>

        <header className="sticky top-0 z-40 flex items-center gap-3 bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
          <button
            type="button"
            className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            <Menu className="size-5" />
          </button>
          <Logo />
          <p className="min-w-0 truncate text-sm font-semibold">{workspace.company.name}</p>
        </header>

        <div className={cn("transition-[padding] duration-200", expanded ? "md:pl-60" : "md:pl-[4.5rem]")}>
          <main className="mx-auto max-w-[90rem] space-y-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <button type="button" className="absolute inset-0 bg-primary/70" onClick={() => setDrawerOpen(false)} aria-label="Close navigation menu" />
            <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col gap-4 bg-sidebar p-4 text-sidebar-foreground">
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Logo />
                  <p className="truncate text-sm font-semibold">{workspace.company.name}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  autoFocus
                >
                  <X className="size-5" />
                </Button>
              </div>
              <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto">
                <NavList items={items} active={active} expanded onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <SidebarFooter workspace={workspace} unreadCount={unreadCount} expanded onSignOut={onSignOut} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
