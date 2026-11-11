import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { companies, companyMemberships } from "./schema";

export async function getRequestContext() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const [membership] = await getDb().select({
    companyId: companyMemberships.companyId,
    role: companyMemberships.role,
    companyName: companies.name,
  }).from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.userId, session.user.id))
    .limit(1);

  if (!membership) return null;
  return { session, ...membership };
}

export function hasRole(role: string, allowed: string[]) {
  return allowed.includes(role);
}
