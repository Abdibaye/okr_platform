import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { createInvitationToken, deliverInvitation, invitationExpiry, recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { invitations } from "@/server/schema";

export async function POST(request: Request, ctx: RouteContext<"/api/invitations/[id]/resend">) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin"])) return errorResponse("Only admins can resend invitations.", 403);
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Invitation not found.", 404);

  // A fresh token invalidates the previous link; the 7-day window restarts.
  const renewed = await getDb().transaction(async (transaction) => {
    const [invitation] = await transaction.update(invitations).set({
      token: createInvitationToken(),
      status: "pending",
      expiresAt: invitationExpiry(),
      emailDeliveryStatus: "pending",
      emailError: null,
    }).where(and(
      eq(invitations.id, id),
      eq(invitations.companyId, context.companyId),
      inArray(invitations.status, ["pending", "expired"]),
    )).returning();
    if (!invitation) return null;
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "invitation_resent",
      entityType: "invitation",
      entityId: id,
      reason: `Invitation for ${invitation.email} resent`,
    });
    return invitation;
  });
  if (!renewed) return errorResponse("Only pending or expired invitations can be resent.", 409);

  const delivery = await deliverInvitation(request, renewed, context.companyName, context.session.user.name);
  return NextResponse.json({
    invitation: { id: renewed.id, status: renewed.status, emailDeliveryStatus: delivery.status, emailError: delivery.error },
    inviteUrl: delivery.status === "sent" ? undefined : delivery.url,
  });
}
