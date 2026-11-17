import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { hasRole } from "@/server/request-context";
import { companyMemberships, teamMemberships, teams, user } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can view the people directory.", 403);

  const database = getDb();
  const rows = await database.select({
    id: companyMemberships.id,
    userId: companyMemberships.userId,
    name: user.name,
    nameEditable: sql<boolean>`not exists (select 1 from company_memberships other where other.user_id = ${user.id} and other.company_id <> ${context.companyId})`,
    email: user.email,
    role: companyMemberships.role,
    managerId: companyMemberships.managerId,
    jobTitle: companyMemberships.jobTitle,
    isActive: companyMemberships.isActive,
    deactivatedAt: companyMemberships.deactivatedAt,
    createdAt: companyMemberships.createdAt,
  }).from(companyMemberships)
    .innerJoin(user, eq(user.id, companyMemberships.userId))
    .where(eq(companyMemberships.companyId, context.companyId))
    .orderBy(asc(user.name));

  const teamRows = await database.select({
    userId: teamMemberships.userId,
    teamId: teams.id,
    teamName: teams.name,
    isLead: teamMemberships.isLead,
  }).from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(eq(teamMemberships.companyId, context.companyId), isNull(teams.archivedAt)))
    .orderBy(asc(teams.name));

  const namesById = new Map(rows.map((row) => [row.userId, row.name]));
  const teamsByUser = new Map<string, { id: string; name: string; isLead: boolean }[]>();
  for (const row of teamRows) {
    const list = teamsByUser.get(row.userId) ?? [];
    list.push({ id: row.teamId, name: row.teamName, isLead: row.isLead });
    teamsByUser.set(row.userId, list);
  }

  const members = rows.map((row) => ({
    ...row,
    managerName: row.managerId ? namesById.get(row.managerId) ?? null : null,
    directReportCount: rows.filter((other) => other.managerId === row.userId && other.isActive).length,
    teams: teamsByUser.get(row.userId) ?? [],
  }));

  return NextResponse.json({ members }, { headers: { "Cache-Control": "no-store" } });
}
