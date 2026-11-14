import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { canViewObjective, loadAccessIndex, viewerFromContext } from "./org-access";
import type { RequestContext } from "./request-context";
import { keyResults, objectives, okrCycles, user } from "./schema";

/**
 * A cycle's non-archived goals and key results, filtered to what the viewer may see.
 * Reports and CSV exports are built from this so they can never include hidden goals.
 */
export async function loadVisibleCycleGoals(context: RequestContext, cycleId: string) {
  const database = getDb();
  const [cycle] = await database.select().from(okrCycles)
    .where(and(eq(okrCycles.id, cycleId), eq(okrCycles.companyId, context.companyId)))
    .limit(1);
  if (!cycle) return null;
  const rows = await database.select({ objective: objectives, ownerName: user.name })
    .from(objectives)
    .leftJoin(user, eq(user.id, objectives.ownerId))
    .where(and(eq(objectives.companyId, context.companyId), eq(objectives.cycleId, cycle.id), isNull(objectives.archivedAt)))
    .orderBy(desc(objectives.createdAt));
  const index = await loadAccessIndex(database, context.companyId, rows.map((row) => row.objective.id));
  const viewer = viewerFromContext(context);
  const visible = rows.filter((row) => canViewObjective(row.objective, viewer, index.factsFor(row.objective)));
  const results = visible.length
    ? await database.select({ keyResult: keyResults, ownerName: user.name }).from(keyResults)
      .leftJoin(user, eq(user.id, keyResults.ownerId))
      .where(and(
        eq(keyResults.companyId, context.companyId),
        inArray(keyResults.objectiveId, visible.map((row) => row.objective.id)),
        isNull(keyResults.archivedAt),
      ))
      .orderBy(asc(keyResults.createdAt))
    : [];
  return {
    cycle,
    goals: visible.map(({ objective, ownerName }) => ({
      ...objective,
      ownerName,
      keyResults: results.filter((row) => row.keyResult.objectiveId === objective.id).map((row) => ({ ...row.keyResult, ownerName: row.ownerName })),
    })),
  };
}
