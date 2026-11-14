import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { createNotifications, deliverNotificationEmails, type NotificationEntry } from "@/server/notifications";
import { canRequestCheckIn, canViewObjective, loadObjectiveAccessFacts, loadOrgChart, viewerFromChart, viewerFromContext } from "@/server/org-access";
import { keyResults, objectives, user } from "@/server/schema";

const NOT_FOUND = "Goal not found.";

/**
 * A manager (anywhere above the person in the reporting chain) or an admin asks someone to check in,
 * either on a goal, a key result or in general (a direct report). One request per target per day.
 */
export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  if (!body) return errorResponse("Choose a goal, key result or person.", 400);
  const targets = (["objectiveId", "keyResultId", "userId"] as const).filter((key) => typeof body[key] === "string" && body[key]);
  if (targets.length !== 1) return errorResponse("Choose exactly one goal, key result or person.", 400);
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  const email = body.email !== false;

  const database = getDb();
  const viewer = viewerFromContext(context);
  const actorId = viewer.userId;
  const chart = await loadOrgChart(database, context.companyId);
  const [actor] = await database.select({ name: user.name }).from(user).where(eq(user.id, actorId)).limit(1);
  const actorName = actor?.name ?? "Your manager";

  let entry: NotificationEntry;
  if (targets[0] === "userId") {
    const recipientId = body.userId as string;
    const recipient = viewerFromChart(chart, recipientId);
    if (!recipient || recipientId === actorId) return errorResponse("Person not found.", 404);
    if (!canRequestCheckIn(viewer, chart, recipientId)) return errorResponse("Only their managers and admins can request a check-in.", 403);
    entry = {
      companyId: context.companyId, recipientId, actorId, type: "check_in_request", objectiveId: null, entityType: "user", entityId: recipientId,
      title: `${actorName} asked you to check in on your goals`,
      body: message || "Please post updates on your key results.",
      dedupKey: `check_in_request:user:${recipientId}:${new Date().toISOString().slice(0, 10)}`,
    };
  } else {
    const id = body[targets[0]] as string;
    if (!isUuid(id)) return errorResponse(NOT_FOUND, 404);
    let goal: typeof objectives.$inferSelect | undefined;
    let keyResult: { id: string; title: string; ownerId: string | null } | undefined;
    if (targets[0] === "keyResultId") {
      const [row] = await database.select({ keyResult: { id: keyResults.id, title: keyResults.title, ownerId: keyResults.ownerId }, objective: objectives })
        .from(keyResults)
        .innerJoin(objectives, eq(objectives.id, keyResults.objectiveId))
        .where(and(eq(keyResults.id, id), eq(keyResults.companyId, context.companyId), isNull(keyResults.archivedAt), isNull(objectives.archivedAt)))
        .limit(1);
      goal = row?.objective;
      keyResult = row?.keyResult;
    } else {
      [goal] = await database.select().from(objectives)
        .where(and(eq(objectives.id, id), eq(objectives.companyId, context.companyId), isNull(objectives.archivedAt)))
        .limit(1);
    }
    if (!goal) return errorResponse(NOT_FOUND, 404);
    const facts = await loadObjectiveAccessFacts(database, context.companyId, goal.id, goal.ownerId);
    if (!canViewObjective(goal, viewer, facts)) return errorResponse(NOT_FOUND, 404);
    const recipientId = keyResult?.ownerId ?? goal.ownerId;
    if (!recipientId || !viewerFromChart(chart, recipientId)) return errorResponse("This has no active owner to ask.", 400);
    if (recipientId === actorId) return errorResponse("You own this; check in directly instead.", 400);
    if (!canRequestCheckIn(viewer, chart, recipientId)) return errorResponse("Only the owner's managers and admins can request a check-in.", 403);
    const title = keyResult?.title ?? goal.title;
    entry = {
      companyId: context.companyId, recipientId, actorId, type: "check_in_request", objectiveId: goal.id,
      entityType: keyResult ? "key_result" : "objective", entityId: keyResult?.id ?? goal.id,
      title: `${actorName} asked for a check-in on ${title}`,
      body: message || "Please post an update with your latest value and confidence.",
      dedupKey: `check_in_request:${keyResult?.id ?? goal.id}:${recipientId}:${new Date().toISOString().slice(0, 10)}`,
    };
  }

  const created = await createNotifications(database, [entry], { email });
  if (email) await deliverNotificationEmails(created);
  return NextResponse.json({ created: created.length > 0 }, { status: created.length ? 201 : 200 });
}
