import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { getDb } from "./db";
import { createNotifications, deliverNotificationEmails, type NotificationEntry } from "./notifications";
import { loadOrgChart } from "./org-access";
import { keyResults, notifications, objectives, okrCycles } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30 } as const;
const REMINDER_TYPES = ["check_in_cadence", "approaching_deadline", "overdue_update"] as const;
const DUE_SOON_DAYS = 7;

type Executor = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

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
 * Clears stale check-in requests and reminders:
 * - When the cycle is closed or archived.
 * - When the objective/KR is archived, completed, or cancelled.
 * - When the key result progress has reached 100%.
 * - When a check-in occurred on or after the request was created.
 * - When a user has no active key results in open cycles (for user-level requests).
 * - When the request/reminder is older than 30 days.
 */
export async function clearStaleRequests(database: Executor, companyId: string, now = new Date()): Promise<number> {
  const requestTypes = ["check_in_request", "check_in_cadence", "approaching_deadline", "overdue_update"] as const;

  const unread = await database.select({
    id: notifications.id,
    type: notifications.type,
    entityType: notifications.entityType,
    entityId: notifications.entityId,
    recipientId: notifications.recipientId,
    createdAt: notifications.createdAt,
  })
    .from(notifications)
    .where(and(
      eq(notifications.companyId, companyId),
      isNull(notifications.readAt),
      inArray(notifications.type, [...requestTypes]),
    ));

  if (!unread.length) return 0;

  const staleIds = new Set<string>();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const objIdsToCheck = new Set<string>();
  const krIdsToCheck = new Set<string>();
  const userRecipients = new Set<string>();

  for (const n of unread) {
    if (n.createdAt < thirtyDaysAgo) {
      staleIds.add(n.id);
      continue;
    }
    if (n.entityType === "objective" && n.entityId) objIdsToCheck.add(n.entityId);
    if (n.entityType === "key_result" && n.entityId) krIdsToCheck.add(n.entityId);
    if (n.entityType === "user" && n.recipientId) userRecipients.add(n.recipientId);
  }

  const krMap = new Map<string, { id: string; objectiveId: string; progress: string | null; archivedAt: Date | null; lastCheckInAt: Date | null }>();
  if (krIdsToCheck.size > 0) {
    const krRows = await database.select({
      id: keyResults.id,
      objectiveId: keyResults.objectiveId,
      progress: keyResults.progress,
      archivedAt: keyResults.archivedAt,
      lastCheckInAt: keyResults.lastCheckInAt,
    }).from(keyResults).where(and(
      eq(keyResults.companyId, companyId),
      inArray(keyResults.id, [...krIdsToCheck]),
    ));
    for (const row of krRows) {
      krMap.set(row.id, row);
      if (row.objectiveId) objIdsToCheck.add(row.objectiveId);
    }
  }

  const objectivesMap = new Map<string, { id: string; cycleId: string; status: string; archivedAt: Date | null }>();
  if (objIdsToCheck.size > 0) {
    const objRows = await database.select({
      id: objectives.id,
      cycleId: objectives.cycleId,
      status: objectives.status,
      archivedAt: objectives.archivedAt,
    }).from(objectives).where(and(
      eq(objectives.companyId, companyId),
      inArray(objectives.id, [...objIdsToCheck]),
    ));
    for (const row of objRows) {
      objectivesMap.set(row.id, row);
    }
  }

  const cycleIdsToCheck = new Set<string>();
  for (const obj of objectivesMap.values()) {
    if (obj.cycleId) cycleIdsToCheck.add(obj.cycleId);
  }

  const cycleMap = new Map<string, { id: string; status: string; archivedAt: Date | null }>();
  if (cycleIdsToCheck.size > 0) {
    const cycleRows = await database.select({
      id: okrCycles.id,
      status: okrCycles.status,
      archivedAt: okrCycles.archivedAt,
    }).from(okrCycles).where(and(
      eq(okrCycles.companyId, companyId),
      inArray(okrCycles.id, [...cycleIdsToCheck]),
    ));
    for (const row of cycleRows) cycleMap.set(row.id, row);
  }

  const activeUserSet = new Set<string>();
  if (userRecipients.size > 0) {
    const activeRows = await database.select({
      krOwnerId: keyResults.ownerId,
      objOwnerId: objectives.ownerId,
    })
      .from(keyResults)
      .innerJoin(objectives, eq(objectives.id, keyResults.objectiveId))
      .innerJoin(okrCycles, eq(okrCycles.id, objectives.cycleId))
      .where(and(
        eq(keyResults.companyId, companyId),
        eq(okrCycles.status, "open"),
        isNull(okrCycles.archivedAt),
        isNull(objectives.archivedAt),
        isNull(keyResults.archivedAt),
        notInArray(objectives.status, ["completed", "cancelled"]),
        or(
          inArray(keyResults.ownerId, [...userRecipients]),
          inArray(objectives.ownerId, [...userRecipients]),
        ),
      ));
    for (const row of activeRows) {
      if (row.krOwnerId) activeUserSet.add(row.krOwnerId);
      if (row.objOwnerId) activeUserSet.add(row.objOwnerId);
    }
  }

  for (const n of unread) {
    if (staleIds.has(n.id)) continue;

    if (n.entityType === "user") {
      if (!activeUserSet.has(n.recipientId)) {
        staleIds.add(n.id);
      }
      continue;
    }

    if (n.entityType === "key_result") {
      const kr = n.entityId ? krMap.get(n.entityId) : null;
      if (!kr || kr.archivedAt || Number(kr.progress ?? 0) >= 100 || (kr.lastCheckInAt && kr.lastCheckInAt >= n.createdAt)) {
        staleIds.add(n.id);
        continue;
      }
      const obj = objectivesMap.get(kr.objectiveId);
      if (!obj || obj.archivedAt || obj.status === "completed" || obj.status === "cancelled") {
        staleIds.add(n.id);
        continue;
      }
      const cycle = cycleMap.get(obj.cycleId);
      if (!cycle || cycle.status === "closed" || cycle.archivedAt) {
        staleIds.add(n.id);
        continue;
      }
    } else if (n.entityType === "objective") {
      const obj = n.entityId ? objectivesMap.get(n.entityId) : null;
      if (!obj || obj.archivedAt || obj.status === "completed" || obj.status === "cancelled") {
        staleIds.add(n.id);
        continue;
      }
      const cycle = cycleMap.get(obj.cycleId);
      if (!cycle || cycle.status === "closed" || cycle.archivedAt) {
        staleIds.add(n.id);
        continue;
      }
    }
  }

  const idsToMark = [...staleIds];
  if (idsToMark.length > 0) {
    await database.update(notifications)
      .set({ readAt: now })
      .where(and(
        eq(notifications.companyId, companyId),
        inArray(notifications.id, idsToMark),
      ));
  }

  return idsToMark.length;
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

  const staleResolved = await clearStaleRequests(database, companyId, now);

  await deliverNotificationEmails(created);
  return { evaluated: goals.length + results.length, created: created.length, resolved: outdated.length + staleResolved };
}
