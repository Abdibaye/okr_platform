import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { notifications } from "@/server/schema";

/** PATCH /api/notifications/<id> { read } marks one notification; /api/notifications/all marks every unread one read. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  const mine = and(eq(notifications.companyId, context.companyId), eq(notifications.recipientId, context.session.user.id));
  const database = getDb();

  if (id === "all") {
    const updated = await database.update(notifications).set({ readAt: new Date() })
      .where(and(mine, isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return NextResponse.json({ updated: updated.length });
  }
  if (!isUuid(id)) return errorResponse("Notification not found.", 404);
  const body = await readJson(request);
  const read = body?.read === undefined ? true : body.read;
  if (typeof read !== "boolean") return errorResponse("Set read to true or false.", 400);
  const [updated] = await database.update(notifications).set({ readAt: read ? new Date() : null })
    .where(and(mine, eq(notifications.id, id)))
    .returning({ id: notifications.id, readAt: notifications.readAt });
  if (!updated) return errorResponse("Notification not found.", 404);
  return NextResponse.json({ notification: updated });
}
