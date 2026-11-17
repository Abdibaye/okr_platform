"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CheckCheck, MailWarning, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AppNotification } from "@/app/types";

const POLL_MS = 60_000;
/** Fired when a notification links to a goal while the Goals page is already open. */
export const OPEN_GOAL_EVENT = "okr:open-goal";

function timeAgo(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationBell({ expanded, itemClass, onNavigate }: {
  expanded: boolean;
  itemClass: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json();
    setItems(data.notifications ?? []);
    setUnread(data.unreadCount ?? 0);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function markRead(id: string) {
    setItems((current) => current.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item)));
    const response = await fetch(`/api/notifications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
    if (response.ok) void load();
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications/all", { method: "PATCH" });
    if (response.ok) void load();
  }

  async function retry(id: string) {
    setRetrying(id);
    setError(null);
    try {
      const response = await fetch(`/api/notifications/${id}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error ?? "Retry failed.");
      else if (data.emailStatus === "failed") setError(data.emailError ?? "The email still could not be sent.");
      await load();
    } finally {
      setRetrying(null);
    }
  }

  function openLink(event: React.MouseEvent, item: AppNotification) {
    if (!item.readAt) void markRead(item.id);
    setOpen(false);
    onNavigate?.();
    const goalId = item.linkPath ? new URL(item.linkPath, window.location.origin).searchParams.get("goal") : null;
    if (goalId && pathname === "/dashboard/goals") {
      event.preventDefault();
      window.history.replaceState(null, "", item.linkPath!);
      window.dispatchEvent(new CustomEvent(OPEN_GOAL_EVENT, { detail: goalId }));
    }
  }

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={expanded ? undefined : label} className={cn(itemClass, !expanded && "justify-center px-0")}>
          <span className="relative">
            <Bell className="size-5" aria-hidden="true" />
            {unread > 0 && (
              <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-brand-coral px-1 text-[10px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          {expanded && <span>Notifications</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={12} className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{unread ? `${unread} unread` : "You're all caught up"}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={markAllRead} disabled={!unread}>
            <CheckCheck className="size-4" aria-hidden="true" />
            Mark all read
          </Button>
        </div>
        {error && <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p>}
        <ul className="max-h-[26rem] overflow-y-auto" aria-label="Notifications">
          {!loaded && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</li>}
          {loaded && !items.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications yet.</li>}
          {items.map((item) => (
            <li key={item.id} className={cn("border-b px-4 py-3 last:border-b-0", !item.readAt && "bg-accent/40")}>
              <div className="flex items-start gap-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-brand-coral")} aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1">
                  {item.linkPath ? (
                    <Link href={item.linkPath} onClick={(event) => openLink(event, item)} className="block text-sm font-medium leading-snug hover:underline">
                      {item.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium leading-snug">{item.title}</p>
                  )}
                  {item.body && <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.actorName ? `${item.actorName} · ` : ""}{timeAgo(item.createdAt)}</span>
                    {item.emailStatus === "in_app_only" && <Badge variant="outline">In-app only</Badge>}
                    {item.emailStatus === "pending" && <Badge variant="outline">Email sending</Badge>}
                    {item.emailStatus === "failed" && (
                      <>
                        <Badge variant="destructive" title={item.emailError ?? undefined}>
                          <MailWarning className="size-3" aria-hidden="true" />
                          Email failed
                        </Badge>
                        <Button variant="outline" size="xs" onClick={() => retry(item.id)} disabled={retrying === item.id}>
                          <RotateCw className={cn("size-3", retrying === item.id && "animate-spin")} aria-hidden="true" />
                          {retrying === item.id ? "Retrying…" : "Retry"}
                        </Button>
                      </>
                    )}
                  </div>
                  {item.emailStatus === "failed" && item.emailError && <p className="text-xs text-destructive">{item.emailError}</p>}
                </div>
                {!item.readAt && (
                  <Button variant="ghost" size="xs" onClick={() => markRead(item.id)} aria-label={`Mark “${item.title}” as read`}>
                    Mark read
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
