import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { getDb } from "./db";
import { createNotifications, deliverNotificationEmails, type NotificationEntry } from "./notifications";
import { loadOrgChart } from "./org-access";
import { keyResults, notifications, objectives, okrCycles } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30 } as const;
const REMINDER_TYPES = ["check_in_cadence", "approaching_deadline", "overdue_update"] as const;
const DUE_SOON_DAYS = 7;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** ISO-8601 week label such as 2026-W46, used to remind about overdue work at most once a week. */
export function isoWeek(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Start date of the cadence period a stale key result is in, counted from its last check-in (or creation).
 * A new check-in moves the anchor, so the next reminder gets a new key; repeating a sweep in the same period does not.
 */
export function stalePeriodBucket(reference: Date, now: Date, cadenceDays: number) {
  const days = Math.floor((now.getTime() - reference.getTime()) / DAY_MS);
  if (days < cadenceDays) return null;
  const periods = Math.floor(days / cadenceDays);
  return isoDate(new Date(reference.getTime() + periods * cadenceDays * DAY_MS));
}

export interface SweepResult {
  companies: number;
  evaluated: number;
  created: number;
  resolved: number;
}

/**
 * Evaluates open cycles and creates stale / due-soon / overdue reminders. Keys are deterministic and
 * inserted with ON CONFLICT DO NOTHING, so repeated sweeps never duplicate. Unread reminders that no
 * longer apply (after a check-in, completion, reassignment or cycle closure) are marked read.
 */
export async function runReminderSweep(companyId: string | null, now = new Date()): Promise<SweepResult> {
  const database = getDb();
  const companyIds = companyId
    ? [companyId]
    : [...new Set((await database.select({ companyId: okrCycles.companyId }).from(okrCycles)
      .where(and(eq(okrCycles.status, "open"), isNull(okrCycles.archivedAt)))).map((row) => row.companyId))];
  const result: SweepResult = { companies: companyIds.length, evaluated: 0, created: 0, resolved: 0 };
  for (const id of companyIds) {
    const summary = await sweepCompany(id, now);
    result.evaluated += summary.evaluated;
    result.created += summary.created;
    result.resolved += summary.resolved;
  }
  return result;
}

async function sweepCompany(companyId: string, now: Date) {
  const database = getDb();
  const today = isoDate(now);
  const dueSoonLimit = isoDate(new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS));
  const week = isoWeek(now);

  const cycles = await database.select().from(okrCycles).where(and(
    eq(okrCycles.companyId, companyId),
    eq(okrCycles.status, "open"),
    isNull(okrCycles.archivedAt),
  ));
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const goals = cycles.length
    ? await database.select().from(objectives).where(and(
      eq(objectives.companyId, companyId),
      inArray(objectives.cycleId, cycles.map((cycle) => cycle.id)),
      isNull(objectives.archivedAt),
      notInArray(objectives.status, ["completed", "cancelled"]),
    ))
    : [];
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const results = goals.length
    ? await database.select().from(keyResults).where(and(
      eq(keyResults.companyId, companyId),
      inArray(keyResults.objectiveId, goals.map((goal) => goal.id)),
      isNull(keyResults.archivedAt),
    ))
    : [];
  const chart = await loadOrgChart(database, companyId);
  const activeOwner = (ownerId: string | null) => (ownerId && chart.get(ownerId)?.isActive ? ownerId : null);

  const entries: NotificationEntry[] = [];
  const deadline = (item: { id: string; title: string; dueDate: string | null; progress: string | null }, ownerId: string, objectiveId: string, entityType: "objective" | "key_result") => {
    if (!item.dueDate || Number(item.progress ?? 0) >= 100) return;
    const label = entityType === "objective" ? "Goal" : "Key result";
    if (item.dueDate < today) {
      entries.push({
        companyId, recipientId: ownerId, actorId: null, type: "overdue_update", objectiveId, entityType, entityId: item.id,
        title: `${label} overdue: ${item.title}`,
        body: `It was due ${item.dueDate} and is at ${Number(Number(item.progress ?? 0).toFixed(0))}%. Post an update or adjust the due date.`,
        dedupKey: `overdue:${item.id}:${ownerId}:${week}`,
      });
    } else if (item.dueDate <= dueSoonLimit) {
      entries.push({
        companyId, recipientId: ownerId, actorId: null, type: "approaching_deadline", objectiveId, entityType, entityId: item.id,
        title: `${label} due soon: ${item.title}`,
        body: `Due ${item.dueDate}; currently ${Number(Number(item.progress ?? 0).toFixed(0))}%.`,
        dedupKey: `due_soon:${item.id}:${ownerId}:${item.dueDate}`,
      });
    }
  };

  for (const goal of goals) {
    const ownerId = activeOwner(goal.ownerId);
    if (ownerId) deadline(goal, ownerId, goal.id, "objective");
  }
  for (const result of results) {
    const goal = goalById.get(result.objectiveId)!;
    const cycle = cycleById.get(goal.cycleId)!;
    const ownerId = activeOwner(result.ownerId ?? goal.ownerId);
    if (!ownerId) continue;
    deadline(result, ownerId, goal.id, "key_result");
    if (Number(result.progress) >= 100) continue;
    const cadence = CADENCE_DAYS[cycle.checkInCadence];
    const bucket = stalePeriodBucket(result.lastCheckInAt ?? result.createdAt, now, cadence);
    if (!bucket) continue;
    entries.push({
      companyId, recipientId: ownerId, actorId: null, type: "check_in_cadence", objectiveId: goal.id, entityType: "key_result", entityId: result.id,
      title: `Check-in due: ${result.title}`,
      body: `No check-in since ${isoDate(result.lastCheckInAt ?? result.createdAt)}. ${cycle.name} expects a ${cycle.checkInCadence} update.`,
      dedupKey: `stale:${result.id}:${ownerId}:${bucket}`,
    });
  }

  const created = await createNotifications(database, entries);

  // Retire unread reminders whose condition no longer holds (or that a newer period superseded).
  const current = new Set(entries.map((entry) => `${entry.recipientId}|${entry.dedupKey}`));
  const unread = await database.select({ id: notifications.id, recipientId: notifications.recipientId, dedupKey: notifications.dedupKey })
    .from(notifications)
    .where(and(eq(notifications.companyId, companyId), inArray(notifications.type, [...REMINDER_TYPES]), isNull(notifications.readAt)));
  const outdated = unread.filter((row) => !current.has(`${row.recipientId}|${row.dedupKey}`)).map((row) => row.id);
  if (outdated.length) await database.update(notifications).set({ readAt: now }).where(inArray(notifications.id, outdated));

  await deliverNotificationEmails(created);
  return { evaluated: goals.length + results.length, created: created.length, resolved: outdated.length };
}
