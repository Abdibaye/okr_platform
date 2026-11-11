import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { keyResults, objectives } from "./schema";
import { averageProgress } from "./okr-math";

export async function refreshObjectiveProgress(
  transaction: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  objectiveId: string,
  companyId: string,
) {
  const rows = await transaction.select({ progress: keyResults.progress })
    .from(keyResults)
    .where(and(eq(keyResults.objectiveId, objectiveId), eq(keyResults.companyId, companyId)));
  const progress = averageProgress(rows.map((row) => Number(row.progress)));
  await transaction.update(objectives).set({
    progress: progress.toFixed(2),
    version: sql`${objectives.version} + 1`,
    updatedAt: new Date(),
  }).where(and(eq(objectives.id, objectiveId), eq(objectives.companyId, companyId)));
  return progress;
}
