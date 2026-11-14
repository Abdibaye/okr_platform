import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { keyResults, objectives } from "./schema";
import { averageProgress } from "./okr-math";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Recomputes an objective's progress from its own non-archived key results only.
 * Child (aligned) objectives never feed into a parent's percentage; no KRs means null.
 */
export async function refreshObjectiveProgress(
  transaction: Transaction,
  objectiveId: string,
  companyId: string,
) {
  const rows = await transaction.select({ progress: keyResults.progress })
    .from(keyResults)
    .where(and(
      eq(keyResults.objectiveId, objectiveId),
      eq(keyResults.companyId, companyId),
      isNull(keyResults.archivedAt),
    ));
  const progress = averageProgress(rows.map((row) => Number(row.progress)));
  await transaction.update(objectives).set({
    progress: progress === null ? null : progress.toFixed(2),
    version: sql`${objectives.version} + 1`,
    updatedAt: new Date(),
  }).where(and(eq(objectives.id, objectiveId), eq(objectives.companyId, companyId)));
  return progress;
}
