import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isEmail, isResponse, isUuid, normalizeEmail, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import {
  createInvitationToken,
  deliverInvitation,
  expireStaleInvitations,
  invitationExpiry,
  isRole,
  recordAudit,
} from "@/server/people";
import { hasRole } from "@/server/request-context";
import { companyMemberships, invitations, teams, user } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin"])) return errorResponse("Only admins can view invitations.", 403);

  await expireStaleInvitations(context.companyId);
  const rows = await getDb().select({
    id: invitations.id,
    email: invitations.email,
    name: invitations.name,
    role: invitations.role,
    teamId: invitations.teamId,
    teamName: teams.name,
    managerId: invitations.managerId,
    jobTitle: invitations.jobTitle,
    status: invitations.status,
    invitedBy: invitations.invitedBy,
    expiresAt: invitations.expiresAt,
    acceptedAt: invitations.acceptedAt,
    emailDeliveryStatus: invitations.emailDeliveryStatus,
    emailError: invitations.emailError,
    createdAt: invitations.createdAt,
  }).from(invitations)
    .leftJoin(teams, eq(teams.id, invitations.teamId))
    .where(eq(invitations.companyId, context.companyId))
    .orderBy(desc(invitations.createdAt))
    .limit(500);

  return NextResponse.json({ invitations: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin"])) return errorResponse("Only admins can invite people.", 403);

  const body = await readJson(request);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = body?.role === undefined ? "member" : body.role;
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : null;
  const managerId = typeof body?.managerId === "string" && body.managerId ? body.managerId : null;
  const jobTitle = typeof body?.jobTitle === "string" ? body.jobTitle.trim() : "";
  if (!isEmail(email)) return errorResponse("Enter a valid email address.", 400);
  if (name.length > 160) return errorResponse("Name must be 160 characters or fewer.", 400);
  if (!isRole(role)) return errorResponse("Role must be admin, manager or member.", 400);
  if (jobTitle.length > 160) return errorResponse("Job title must be 160 characters or fewer.", 400);
  if (teamId && !isUuid(teamId)) return errorResponse("Team not found.", 400);

  const database = getDb();
  if (teamId) {
    const [team] = await database.select({ id: teams.id }).from(teams).where(and(
      eq(teams.id, teamId), eq(teams.companyId, context.companyId), isNull(teams.archivedAt),
    )).limit(1);
    if (!team) return errorResponse("Team not found.", 400);
  }
  if (managerId) {
    const [manager] = await database.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, context.companyId),
      eq(companyMemberships.userId, managerId),
      eq(companyMemberships.isActive, true),
    )).limit(1);
    if (!manager) return errorResponse("Manager must be an active workspace member.", 400);
  }

  const [existingMember] = await database.select({ isActive: companyMemberships.isActive })
    .from(companyMemberships)
    .innerJoin(user, eq(user.id, companyMemberships.userId))
    .where(and(eq(companyMemberships.companyId, context.companyId), eq(sql`lower(${user.email})`, email)))
    .limit(1);
  if (existingMember?.isActive) return errorResponse("This person is already an active member of the workspace.", 409);

  await expireStaleInvitations(context.companyId);
  const created = await database.transaction(async (transaction) => {
    // Serialise invites for the same address so two admins cannot create duplicate pending invitations.
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`invite:${context.companyId}:${email}`}))`);
    const [pending] = await transaction.select({ id: invitations.id }).from(invitations).where(and(
      eq(invitations.companyId, context.companyId),
      eq(invitations.email, email),
      eq(invitations.status, "pending"),
      gt(invitations.expiresAt, new Date()),
    )).limit(1);
    if (pending) return null;

    const [invitation] = await transaction.insert(invitations).values({
      companyId: context.companyId,
      email,
      name,
      role,
      teamId,
      managerId,
      jobTitle,
      token: createInvitationToken(),
      invitedBy: context.session.user.id,
      expiresAt: invitationExpiry(),
    }).returning();
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "invitation_created",
      entityType: "invitation",
      entityId: invitation.id,
      reason: `Invited ${email} as ${role}`,
      details: { role, teamId, managerId },
    });
    return invitation;
  });
  if (!created) return errorResponse("This email already has a pending invitation. Resend it instead.", 409);

  const delivery = await deliverInvitation(request, created, context.companyName, context.session.user.name);
  return NextResponse.json({
    invitation: { id: created.id, email, status: created.status, emailDeliveryStatus: delivery.status, emailError: delivery.error },
    // Without an email provider the admin shares the link directly.
    inviteUrl: delivery.status === "sent" ? undefined : delivery.url,
  }, { status: 201 });
}
