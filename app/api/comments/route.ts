import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, normalizeEmail, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { createNotifications, deliverNotificationEmails } from "@/server/notifications";
import { canViewObjective, loadVisibleObjective, viewerFromChart, type ObjectiveAccessFacts } from "@/server/org-access";
import type { RequestContext } from "@/server/request-context";
import { companyMemberships, goalComments, keyResults, objectives, user } from "@/server/schema";

export const dynamic = "force-dynamic";

const NOT_FOUND = "Goal not found.";
const MAX_BODY = 5000;
const ID_MENTION = /@\[([^\]\s]{1,200})\]/g;
const EMAIL_MENTION = /(^|[\s(,;])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

type Goal = typeof objectives.$inferSelect;

/** Active members who can see the goal; only they can be mentioned. */
async function mentionablePeople(context: RequestContext, goal: Goal, facts: ObjectiveAccessFacts) {
  const rows = await getDb().select({ id: user.id, name: user.name, email: user.email, jobTitle: companyMemberships.jobTitle })
    .from(companyMemberships)
    .innerJoin(user, eq(user.id, companyMemberships.userId))
    .where(and(eq(companyMemberships.companyId, context.companyId), eq(companyMemberships.isActive, true)))
    .orderBy(user.name);
  return rows.filter((row) => {
    const viewer = viewerFromChart(facts.chart, row.id);
    return viewer !== null && canViewObjective(goal, viewer, facts);
  });
}

/** Resolves `@[userId]` and `@email` mentions; anyone who can't see the goal is silently dropped. */
function parseMentions(body: string, people: { id: string; email: string }[]) {
  const byId = new Map(people.map((person) => [person.id, person.id]));
  const byEmail = new Map(people.map((person) => [normalizeEmail(person.email), person.id]));
  const ids = new Set<string>();
  for (const match of body.matchAll(ID_MENTION)) {
    const id = byId.get(match[1]);
    if (id) ids.add(id);
  }
  for (const match of body.matchAll(EMAIL_MENTION)) {
    const id = byEmail.get(normalizeEmail(match[2]));
    if (id) ids.add(id);
  }
  return [...ids];
}

async function loadTarget(context: RequestContext, objectiveId: unknown, keyResultId: unknown) {
  if (typeof objectiveId !== "string" || !isUuid(objectiveId)) return null;
  const visible = await loadVisibleObjective(getDb(), context, objectiveId);
  if (!visible) return null;
  let keyResult: { id: string; title: string } | null = null;
  if (keyResultId !== undefined && keyResultId !== null && keyResultId !== "") {
    if (typeof keyResultId !== "string" || !isUuid(keyResultId)) return null;
    const [row] = await getDb().select({ id: keyResults.id, title: keyResults.title }).from(keyResults).where(and(
      eq(keyResults.id, keyResultId),
      eq(keyResults.objectiveId, objectiveId),
      eq(keyResults.companyId, context.companyId),
      isNull(keyResults.archivedAt),
    )).limit(1);
    if (!row) return null;
    keyResult = row;
  }
  return { ...visible, keyResult };
}

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const url = new URL(request.url);
  const target = await loadTarget(context, url.searchParams.get("objectiveId"), url.searchParams.get("keyResultId"));
  if (!target) return errorResponse(NOT_FOUND, 404);

  const conditions = [eq(goalComments.companyId, context.companyId), eq(goalComments.objectiveId, target.objective.id)];
  if (target.keyResult) conditions.push(eq(goalComments.keyResultId, target.keyResult.id));
  const rows = await getDb().select({ comment: goalComments, authorName: user.name })
    .from(goalComments)
    .leftJoin(user, eq(user.id, goalComments.authorId))
    .where(and(...conditions))
    .orderBy(asc(goalComments.createdAt))
    .limit(500);
  const people = await mentionablePeople(context, target.objective, target.facts);
  const names = new Map(people.map((person) => [person.id, person.name]));

  return NextResponse.json({
    comments: rows.map(({ comment, authorName }) => ({
      id: comment.id,
      keyResultId: comment.keyResultId,
      authorId: comment.authorId,
      authorName: authorName ?? "Former member",
      body: comment.body,
      mentions: comment.mentions.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
      createdAt: comment.createdAt,
    })),
    // Emails are left out: the picker inserts @[id] tokens, so members never see colleagues' addresses.
    mentionable: people.filter((person) => person.id !== context.session.user.id).map(({ id, name, jobTitle }) => ({ id, name, jobTitle })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text || text.length > MAX_BODY) return errorResponse(`Comments must be 1–${MAX_BODY.toLocaleString("en-US")} characters.`, 400);
  const target = await loadTarget(context, body?.objectiveId, body?.keyResultId);
  if (!target) return errorResponse(NOT_FOUND, 404);

  const authorId = context.session.user.id;
  const people = await mentionablePeople(context, target.objective, target.facts);
  const mentions = parseMentions(text, people).filter((id) => id !== authorId);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const readable = text.replace(ID_MENTION, (token, id: string) => (names.has(id) ? `@${names.get(id)}` : token));
  const authorName = context.session.user.name || "Someone";
  const subject = target.keyResult ? `${target.keyResult.title} (${target.objective.title})` : target.objective.title;

  const { comment, created } = await getDb().transaction(async (transaction) => {
    const [comment] = await transaction.insert(goalComments).values({
      companyId: context.companyId,
      objectiveId: target.objective.id,
      keyResultId: target.keyResult?.id ?? null,
      authorId,
      body: text,
      mentions,
    }).returning();
    const created = await createNotifications(transaction, mentions.map((recipientId) => ({
      companyId: context.companyId,
      recipientId,
      actorId: authorId,
      type: "mention" as const,
      title: `${authorName} mentioned you on ${subject}`,
      body: readable.slice(0, 1000),
      objectiveId: target.objective.id,
      entityType: target.keyResult ? "key_result" as const : "objective" as const,
      entityId: target.keyResult?.id ?? target.objective.id,
      dedupKey: `mention:${comment.id}`,
    })));
    return { comment, created };
  });
  await deliverNotificationEmails(created);

  return NextResponse.json({
    comment: {
      id: comment.id,
      keyResultId: comment.keyResultId,
      authorId,
      authorName,
      body: comment.body,
      mentions: mentions.map((id) => ({ id, name: names.get(id)! })),
      createdAt: comment.createdAt,
    },
    notified: created.length,
  }, { status: 201 });
}
