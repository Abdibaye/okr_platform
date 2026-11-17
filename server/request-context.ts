import { headers } from "next/headers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { companies, companyMemberships, teamMemberships, teams } from "./schema";

export async function getRequestContext() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const database = getDb();
  // Prefer an active membership; newest first so an accepted invitation wins over the demo default.
  const [membership] = await database.select({
    companyId: companyMemberships.companyId,
    role: companyMemberships.role,
    isActive: companyMemberships.isActive,
    managerId: companyMemberships.managerId,
    jobTitle: companyMemberships.jobTitle,
    companyName: companies.name,
  }).from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.userId, session.user.id))
    .orderBy(desc(companyMemberships.isActive), desc(companyMemberships.createdAt))
    .limit(1);

  if (!membership) return null;

  const teamRows = await database.select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(
      eq(teamMemberships.companyId, membership.companyId),
      eq(teamMemberships.userId, session.user.id),
      isNull(teams.archivedAt),
    ));

  return { session, ...membership, teamIds: teamRows.map((row) => row.teamId) };
}

export type RequestContext = NonNullable<Awaited<ReturnType<typeof getRequestContext>>>;

export function hasRole(role: string, allowed: string[]) {
  return allowed.includes(role);
}
