import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { buildPeriodComparisons } from "@/server/okr-math";
import { auditLogs, keyResults, objectives, okrCycles } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;

  const database = getDb();
  const cycles = await database.select().from(okrCycles)
    .where(eq(okrCycles.companyId, context.companyId))
    .orderBy(desc(okrCycles.startDate));
  const cycleIds = cycles.map((cycle) => cycle.id);
  const objectiveRows = cycleIds.length
    ? await database.select().from(objectives).where(and(
      eq(objectives.companyId, context.companyId),
      inArray(objectives.cycleId, cycleIds),
    )).orderBy(desc(objectives.createdAt))
    : [];
  const objectiveIds = objectiveRows.map((objective) => objective.id);
  const resultRows = objectiveIds.length
    ? await database.select().from(keyResults).where(and(
      eq(keyResults.companyId, context.companyId),
      inArray(keyResults.objectiveId, objectiveIds),
    )).orderBy(keyResults.createdAt)
    : [];
  const auditRows = cycleIds.length
    ? await database.select().from(auditLogs).where(and(
      eq(auditLogs.companyId, context.companyId),
      inArray(auditLogs.cycleId, cycleIds),
    )).orderBy(desc(auditLogs.createdAt)).limit(20)
    : [];

  const resultsByObjective = new Map<string, typeof resultRows>();
  for (const result of resultRows) {
    const list = resultsByObjective.get(result.objectiveId) ?? [];
    list.push(result);
    resultsByObjective.set(result.objectiveId, list);
  }
  const objectivesByCycle = new Map<string, typeof objectiveRows>();
  for (const objective of objectiveRows) {
    const list = objectivesByCycle.get(objective.cycleId) ?? [];
    list.push(objective);
    objectivesByCycle.set(objective.cycleId, list);
  }

  const hydratedCycles = cycles.map((cycle) => ({
    ...cycle,
    objectives: (objectivesByCycle.get(cycle.id) ?? []).map((objective) => ({
      ...objective,
      keyResults: resultsByObjective.get(objective.id) ?? [],
    })),
  }));
  const { summaries, comparisons } = buildPeriodComparisons(hydratedCycles);

  return NextResponse.json({
    user: { name: context.session.user.name, email: context.session.user.email },
    company: { id: context.companyId, name: context.companyName, role: context.role },
    cycles: hydratedCycles,
    summaries,
    comparisons,
    audit: auditRows,
  }, { headers: { "Cache-Control": "no-store" } });
}
