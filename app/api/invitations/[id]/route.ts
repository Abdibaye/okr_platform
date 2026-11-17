import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { invitations } from "@/server/schema";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/invitations/[id]">) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin"])) return errorResponse("Only admins can revoke invitations.", 403);
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Invitation not found.", 404);

  const revoked = await getDb().transaction(async (transaction) => {
    const [invitation] = await transaction.update(invitations).set({ status: "revoked" }).where(and(
      eq(invitations.id, id),
      eq(invitations.companyId, context.companyId),
      eq(invitations.status, "pending"),
    )).returning();
    if (!invitation) return null;
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "invitation_revoked",
      entityType: "invitation",
      entityId: id,
      reason: `Invitation for ${invitation.email} revoked`,
    });
    return invitation;
  });
  if (!revoked) return errorResponse("Only pending invitations can be revoked.", 409);
  return NextResponse.json({ invitation: { id: revoked.id, status: revoked.status } });
}
