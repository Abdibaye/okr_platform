import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { emailProvider, sendEmail } from "./email";
import type { Transaction } from "./people";
import { notifications, user } from "./schema";

type Executor = ReturnType<typeof getDb> | Transaction;

export type NotificationType = (typeof notifications.$inferInsert)["type"];

export interface NotificationEntry {
  companyId: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  /** Goal the notification links to; null links to the goals list. */
  objectiveId: string | null;
  entityType: "objective" | "key_result" | "user";
  entityId: string;
  /** Deterministic key; a repeat insert with the same recipient and key is ignored. */
  dedupKey: string;
}

export function goalLink(objectiveId: string | null) {
  return objectiveId ? `/dashboard/goals?goal=${objectiveId}` : "/dashboard/goals";
}

/**
 * Inserts notifications, skipping any whose (company, recipient, dedupKey) already exists.
 * Returns the ids that were actually created. When an email provider is configured the new rows
 * start as `pending` (unless `email` is false); call `deliverNotificationEmails` after the transaction commits.
 */
export async function createNotifications(executor: Executor, entries: NotificationEntry[], { email = true } = {}) {
  if (!entries.length) return [];
  const status = email && emailProvider() ? "pending" as const : "in_app_only" as const;
  const rows = await executor.insert(notifications).values(entries.map((entry) => ({
    companyId: entry.companyId,
    recipientId: entry.recipientId,
    actorId: entry.actorId,
    type: entry.type,
    title: entry.title.slice(0, 240),
    body: entry.body,
    linkPath: goalLink(entry.objectiveId),
    entityType: entry.entityType,
    entityId: entry.entityId,
    dedupKey: entry.dedupKey.slice(0, 240),
    emailStatus: status,
  }))).onConflictDoNothing().returning({ id: notifications.id });
  return rows.map((row) => row.id);
}

function absoluteLink(path: string | null) {
  const base = process.env.BETTER_AUTH_URL;
  if (!path) return null;
  return base ? new URL(path, base).toString() : path;
}

/** Emails one notification and records the outcome; every call counts as an attempt. */
export async function deliverNotificationEmail(notificationId: string) {
  const database = getDb();
  const [row] = await database.select({ notification: notifications, email: user.email })
    .from(notifications)
    .innerJoin(user, eq(user.id, notifications.recipientId))
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!row) return null;
  const link = absoluteLink(row.notification.linkPath);
  const result = await sendEmail({
    to: row.email,
    subject: row.notification.title,
    text: [row.notification.body, link ? `Open in Alineo: ${link}` : ""].filter(Boolean).join("\n\n"),
  });
  const [updated] = await database.update(notifications).set({
    emailStatus: result.status,
    emailError: result.status === "failed" ? result.error : null,
    emailAttempts: sql`${notifications.emailAttempts} + 1`,
    lastAttemptAt: new Date(),
  }).where(eq(notifications.id, notificationId)).returning();
  return updated;
}

/** Sends the emails for freshly created notifications; a no-op without an email provider. */
export async function deliverNotificationEmails(ids: string[]) {
  if (!ids.length || !emailProvider()) return;
  for (const id of ids) await deliverNotificationEmail(id);
}

/** Marks unread notifications about an entity as read, e.g. stale reminders once someone checks in. */
export async function resolveNotifications(executor: Executor, companyId: string, entityId: string, types: NotificationType[]) {
  await executor.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.companyId, companyId),
    eq(notifications.entityId, entityId),
    inArray(notifications.type, types),
    isNull(notifications.readAt),
  ));
}

/** Marks unread notifications about any listed entity as read, e.g. stale check-in requests when a cycle closes. */
export async function resolveNotificationsForEntities(executor: Executor, companyId: string, entityIds: string[], types: NotificationType[]) {
  if (!entityIds.length) return 0;
  const rows = await executor.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.companyId, companyId),
    inArray(notifications.entityId, entityIds),
    inArray(notifications.type, types),
    isNull(notifications.readAt),
  )).returning({ id: notifications.id });
  return rows.length;
}
