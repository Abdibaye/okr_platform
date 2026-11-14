import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { canViewObjective, loadAccessIndex, viewerFromContext } from "@/server/org-access";
import { keyResults, notifications, objectives, user } from "@/server/schema";

export const dynamic = "force-dynamic";

const LIMIT = 50;

/** The signed-in user's latest notifications plus their unread count. */
export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const database = getDb();
  const userId = context.session.user.id;
  const mine = and(eq(notifications.companyId, context.companyId), eq(notifications.recipientId, userId));

  const rows = await database.select({ notification: notifications, actorName: user.name })
    .from(notifications)
    .leftJoin(user, eq(user.id, notifications.actorId))
    .where(mine)
    .orderBy(desc(notifications.createdAt))
    .limit(LIMIT);
  const [{ unread }] = await database.select({ unread: sql<number>`count(*)::int` }).from(notifications)
    .where(and(mine, isNull(notifications.readAt)));

  // Access can change after a notification was sent: re-check the goal and mask it if it is now hidden.
  const krIds = rows.filter((row) => row.notification.entityType === "key_result" && row.notification.entityId).map((row) => row.notification.entityId!);
  const krGoal = new Map((krIds.length
    ? await database.select({ id: keyResults.id, objectiveId: keyResults.objectiveId }).from(keyResults)
      .where(and(eq(keyResults.companyId, context.companyId), inArray(keyResults.id, krIds)))
    : []).map((row) => [row.id, row.objectiveId]));
  const goalIdOf = (entityType: string | null, entityId: string | null) =>
    entityType === "objective" ? entityId : entityType === "key_result" && entityId ? krGoal.get(entityId) ?? null : null;
  const goalIds = [...new Set(rows.map((row) => goalIdOf(row.notification.entityType, row.notification.entityId)).filter((id): id is string => Boolean(id)))];
  const goals = goalIds.length
    ? await database.select().from(objectives).where(and(eq(objectives.companyId, context.companyId), inArray(objectives.id, goalIds)))
    : [];
  const index = await loadAccessIndex(database, context.companyId, goalIds);
  const viewer = viewerFromContext(context);
  const visible = new Set(goals.filter((goal) => !goal.archivedAt && canViewObjective(goal, viewer, index.factsFor(goal))).map((goal) => goal.id));

  const items = rows.map(({ notification, actorName }) => {
    const goalId = goalIdOf(notification.entityType, notification.entityId);
    const hidden = (notification.entityType === "objective" || notification.entityType === "key_result") && (!goalId || !visible.has(goalId));
    return {
      id: notification.id,
      type: notification.type,
      title: hidden ? "Update about a goal you can no longer view" : notification.title,
      body: hidden ? "" : notification.body,
      linkPath: hidden ? null : notification.linkPath,
      actorName: actorName ?? null,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      emailStatus: notification.emailStatus,
      emailError: notification.emailError,
      emailAttempts: notification.emailAttempts,
      lastAttemptAt: notification.lastAttemptAt,
    };
  });
  return NextResponse.json({ notifications: items, unreadCount: unread }, { headers: { "Cache-Control": "no-store" } });
}
