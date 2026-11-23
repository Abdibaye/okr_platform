import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { contextOr401, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import {
  auditLogs,
  companies,
  companyMemberships,
  goalComments,
  invitations,
  keyResultEditors,
  keyResults,
  krCheckIns,
  notifications,
  objectiveAccess,
  objectives,
  okrCycles,
  teamMemberships,
  teams,
  user,
} from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role !== "admin") return NextResponse.json({ error: "Only admins can export company backups." }, { status: 403 });

  const database = getDb();
  const [
    company,
    cycles,
    teamRows,
    teamMembershipRows,
    companyMembershipRows,
    objectiveRows,
    keyResultRows,
    checkIns,
    comments,
    audit,
    objectiveAccessRows,
    keyResultEditorRows,
    invitationRows,
    notificationRows,
  ] = await Promise.all([
    database.select().from(companies).where(eq(companies.id, context.companyId)).limit(1).then((r) => r[0] ?? null),
    database.select().from(okrCycles).where(eq(okrCycles.companyId, context.companyId)),
    database.select().from(teams).where(eq(teams.companyId, context.companyId)),
    database.select().from(teamMemberships).where(eq(teamMemberships.companyId, context.companyId)),
    database.select({
      id: companyMemberships.id,
      companyId: companyMemberships.companyId,
      userId: companyMemberships.userId,
      role: companyMemberships.role,
      managerId: companyMemberships.managerId,
      jobTitle: companyMemberships.jobTitle,
      isActive: companyMemberships.isActive,
      deactivatedAt: companyMemberships.deactivatedAt,
      createdAt: companyMemberships.createdAt,
      updatedAt: companyMemberships.updatedAt,
      name: user.name,
      email: user.email,
      image: user.image,
    }).from(companyMemberships)
      .innerJoin(user, eq(user.id, companyMemberships.userId))
      .where(eq(companyMemberships.companyId, context.companyId)),
    database.select().from(objectives).where(eq(objectives.companyId, context.companyId)),
    database.select().from(keyResults).where(eq(keyResults.companyId, context.companyId)),
    database.select().from(krCheckIns).where(eq(krCheckIns.companyId, context.companyId)),
    database.select().from(goalComments).where(eq(goalComments.companyId, context.companyId)),
    database.select().from(auditLogs).where(eq(auditLogs.companyId, context.companyId)),
    database.select().from(objectiveAccess).where(eq(objectiveAccess.companyId, context.companyId)),
    database.select().from(keyResultEditors).where(eq(keyResultEditors.companyId, context.companyId)),
    database.select().from(invitations).where(eq(invitations.companyId, context.companyId)),
    database.select().from(notifications).where(eq(notifications.companyId, context.companyId)),
  ]);

  const emailByUserId = new Map(companyMembershipRows.map((m) => [m.userId, m.email]));
  const nameByUserId = new Map(companyMembershipRows.map((m) => [m.userId, m.name]));

  // Comprehensive staff directory linking identities, workspace roles, and manager reporting lines
  const staff = companyMembershipRows.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
    managerId: m.managerId,
    managerName: m.managerId ? (nameByUserId.get(m.managerId) ?? null) : null,
    managerEmail: m.managerId ? (emailByUserId.get(m.managerId) ?? null) : null,
    jobTitle: m.jobTitle,
    isActive: m.isActive,
    deactivatedAt: m.deactivatedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));

  const users = companyMembershipRows.map((m) => ({
    id: m.userId,
    name: m.name,
    email: m.email,
    image: m.image,
  }));

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    company,
    cycles,
    teams: teamRows,
    staff,
    users,
    companyMemberships: companyMembershipRows.map(({ name, email, image, ...row }) => row),
    teamMemberships: teamMembershipRows,
    memberships: staff,
    objectives: objectiveRows,
    keyResults: keyResultRows,
    checkIns,
    comments,
    auditLogs: audit,
    objectiveAccess: objectiveAccessRows,
    keyResultEditors: keyResultEditorRows,
    invitations: invitationRows,
    notifications: notificationRows,
  }, { headers: { "Cache-Control": "no-store" } });
}
