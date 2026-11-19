import { headers } from "next/headers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { companies, companyMemberships, teamMemberships, teams } from "./schema";

export async function getRequestContext() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const database = getDb();
  // Load all memberships for this user, ordered with active and newest first
  const allMemberships = await database.select({
    companyId: companyMemberships.companyId,
    role: companyMemberships.role,
    isActive: companyMemberships.isActive,
    managerId: companyMemberships.managerId,
    jobTitle: companyMemberships.jobTitle,
    companyName: companies.name,
  }).from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.userId, session.user.id))
    .orderBy(desc(companyMemberships.isActive), desc(companyMemberships.createdAt));

  if (!allMemberships.length) return null;

  const activeMemberships = allMemberships.filter((m) => m.isActive);
  if (!activeMemberships.length) {
    const deactivated = allMemberships[0];
    return { session, ...deactivated, teamIds: [], availableCompanies: [] };
  }

  // Check if an active_company_id cookie is present
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)active_company_id=([^;]+)/);
  const requestedCompanyId = match ? decodeURIComponent(match[1]) : null;

  const membership = (requestedCompanyId && activeMemberships.find((m) => m.companyId === requestedCompanyId)) || activeMemberships[0];

  const teamRows = await database.select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(
      eq(teamMemberships.companyId, membership.companyId),
      eq(teamMemberships.userId, session.user.id),
      isNull(teams.archivedAt),
    ));

  return {
    session,
    ...membership,
    teamIds: teamRows.map((row) => row.teamId),
    availableCompanies: activeMemberships.map((m) => ({ id: m.companyId, name: m.companyName, role: m.role })),
  };
}

export type RequestContext = NonNullable<Awaited<ReturnType<typeof getRequestContext>>>;

export function hasRole(role: string, allowed: string[]) {
  return allowed.includes(role);
}
