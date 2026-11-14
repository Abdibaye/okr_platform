import { Building2, User, Users, type LucideIcon } from "lucide-react";
import type { ApprovalStatus, GoalLevel, GoalStatus, Objective } from "@/app/types";
import type { ProgressTone } from "./progress";

export const levelLabels: Record<GoalLevel, string> = {
  company: "Company",
  team: "Team",
  individual: "Individual",
};

export const levelIcons: Record<GoalLevel, LucideIcon> = {
  company: Building2,
  team: Users,
  individual: User,
};

export const statusLabels: Record<GoalStatus, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const approvalLabels: Record<ApprovalStatus, string> = {
  not_required: "No approval needed",
  pending: "Awaiting approval",
  approved: "Approved",
  changes_requested: "Changes requested",
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function progressTone(progress: number): ProgressTone {
  if (progress >= 70) return "on_track";
  if (progress >= 40) return "at_risk";
  return "off_track";
}

/** Ids of the goal and every goal aligned beneath it, so they can't be picked as its parent. */
export function selfAndDescendantIds(objectives: Objective[], objectiveId: string) {
  const childrenByParent = new Map<string, string[]>();
  for (const objective of objectives) {
    if (!objective.parentObjectiveId) continue;
    childrenByParent.set(objective.parentObjectiveId, [...(childrenByParent.get(objective.parentObjectiveId) ?? []), objective.id]);
  }
  const excluded = new Set<string>([objectiveId]);
  const queue = [objectiveId];
  while (queue.length) {
    for (const childId of childrenByParent.get(queue.pop()!) ?? []) {
      if (excluded.has(childId)) continue;
      excluded.add(childId);
      queue.push(childId);
    }
  }
  return excluded;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> & { error?: string };
}

/** Plain fetch wrapper for dialogs that show their own inline errors instead of the page banner. */
export async function apiRequest(url: string, method: string, body?: unknown): Promise<ApiResult> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) window.location.href = "/?session=expired";
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/** Turns API failures into messages that say what happened and what to do next. */
export function describeSaveError(result: ApiResult, noun: "goal" | "key result") {
  const serverMessage = result.data.error ?? "The request failed.";
  if (result.status === 409) {
    return `Someone else changed this ${noun} while you were editing. The latest version has been loaded — check the values below and save again.`;
  }
  if (result.status === 403 && /closed/i.test(serverMessage)) {
    return `This cycle is closed, so its ${noun}s can't be changed. An admin can reopen the cycle from the Cycles page.`;
  }
  if (result.status === 400 && /loop/i.test(serverMessage)) {
    return `${serverMessage} Choose a different parent goal.`;
  }
  return serverMessage;
}
