"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarRange,
  ChevronsLeft,
  ChevronsRight,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Target,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/okr/theme-toggle";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/app/types";

interface NavItem {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  managersOnly?: boolean;
}

const navItems: NavItem[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "goals", href: "/dashboard/goals", label: "Goals", icon: Target },
  { id: "cycles", href: "/dashboard/cycles", label: "Cycles", icon: CalendarRange },
  { id: "insights", href: "/dashboard/insights", label: "Insights", icon: TrendingUp },
  { id: "activity", href: "/dashboard/activity", label: "Activity", icon: History },
  { id: "team", href: "/dashboard/team", label: "Team", icon: Users, managersOnly: true },
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

function NavList({ items, expanded, onNavigate }: {
  items: NavItem[];
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="grid gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname.startsWith(item.href);
        return (
          <li key={item.id}>
            <SidebarTip show={!expanded} label={item.label}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  itemClass,
                  !expanded && "justify-center px-0",
                  isActive && "bg-brand-teal text-sidebar hover:bg-brand-teal hover:text-sidebar",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {expanded && <span className="truncate">{item.label}</span>}
              </Link>
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
        <Link href="/dashboard/activity" onClick={onNavigate} aria-label={`${unreadCount} recent audit updates`} className={cn(itemClass, !expanded && "justify-center px-0")}>
          <span className="relative">
            <Bell className="size-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-brand-coral px-1 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </span>
          {expanded && <span>Recent updates</span>}
        </Link>
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
  peopleView?: boolean;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const canManage = workspace.company.role !== "member";
  const items = navItems.filter((item) => canManage || !item.managersOnly);

  useEffect(() => {
    setExpanded(window.localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

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
            <NavList items={items} expanded={expanded} />
          </nav>
          <SidebarFooter workspace={workspace} unreadCount={unreadCount} expanded={expanded} onSignOut={onSignOut} />
        </aside>

        <header className="sticky top-0 z-40 flex items-center gap-3 bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
          <button
            type="button"
            className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => setDrawerOpen(true)}
            id="mobile-navigation-toggle"
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

        <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogContent showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("mobile-navigation-toggle")?.focus(); }} className="inset-y-0 left-0 flex h-dvh w-[86%] max-w-xs translate-x-0 translate-y-0 flex-col gap-4 rounded-none border-0 bg-sidebar p-4 text-sidebar-foreground sm:max-w-xs">
              <DialogTitle className="sr-only">Navigation menu</DialogTitle>
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
                <NavList items={items} expanded onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <SidebarFooter workspace={workspace} unreadCount={unreadCount} expanded onSignOut={onSignOut} onNavigate={() => setDrawerOpen(false)} />
            </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
