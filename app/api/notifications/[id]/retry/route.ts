import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { deliverNotificationEmail } from "@/server/notifications";
import { notifications } from "@/server/schema";

/** Retries a failed notification email. Allowed for the recipient and for admins of the same company. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Notification not found.", 404);
  const [notification] = await getDb().select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.companyId, context.companyId)))
    .limit(1);
  if (!notification || (notification.recipientId !== context.session.user.id && context.role !== "admin")) {
    return errorResponse("Notification not found.", 404);
  }
  // Claim the retry atomically so a double click sends at most one email.
  const [claimed] = await getDb().update(notifications).set({ emailStatus: "pending" })
    .where(and(eq(notifications.id, id), eq(notifications.emailStatus, "failed")))
    .returning({ id: notifications.id });
  if (!claimed) return errorResponse("Only failed emails can be retried.", 409);
  const updated = await deliverNotificationEmail(id);
  return NextResponse.json({
    emailStatus: updated?.emailStatus ?? "failed",
    emailError: updated?.emailError ?? null,
    emailAttempts: updated?.emailAttempts ?? 0,
  });
}
