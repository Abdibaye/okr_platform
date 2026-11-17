import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { contextOr401, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { auditLogs, companies, goalComments, keyResults, krCheckIns, objectives, okrCycles, teamMemberships, teams } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role !== "admin") return NextResponse.json({ error: "Only admins can export company backups." }, { status: 403 });
  const database = getDb();
  const [company] = await database.select().from(companies).where(eq(companies.id, context.companyId)).limit(1);
  const [cycles, teamRows, memberships, objectiveRows, keyResultRows, checkIns, comments, audit] = await Promise.all([
    database.select().from(okrCycles).where(eq(okrCycles.companyId, context.companyId)),
    database.select().from(teams).where(eq(teams.companyId, context.companyId)),
    database.select().from(teamMemberships).where(eq(teamMemberships.companyId, context.companyId)),
    database.select().from(objectives).where(eq(objectives.companyId, context.companyId)),
    database.select().from(keyResults).where(eq(keyResults.companyId, context.companyId)),
    database.select().from(krCheckIns).where(eq(krCheckIns.companyId, context.companyId)),
    database.select().from(goalComments).where(eq(goalComments.companyId, context.companyId)),
    database.select().from(auditLogs).where(eq(auditLogs.companyId, context.companyId)),
  ]);
  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    company,
    cycles,
    teams: teamRows,
    memberships,
    objectives: objectiveRows,
    keyResults: keyResultRows,
    checkIns,
    comments,
    auditLogs: audit,
  }, { headers: { "Cache-Control": "no-store" } });
}
