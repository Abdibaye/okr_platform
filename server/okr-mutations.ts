import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { keyResults, krCheckIns, objectives } from "./schema";
import { averageProgress, calculateProgress, selectEffectiveCheckIn } from "./okr-math";
import { InputError } from "./objectives";

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

/** Today's date (YYYY-MM-DD, UTC) clamped into a cycle's date range. */
export function todayWithinCycle(cycle: { startDate: string; endDate: string }) {
  const today = new Date().toISOString().slice(0, 10);
  if (today < cycle.startDate) return cycle.startDate;
  if (today > cycle.endDate) return cycle.endDate;
  return today;
}

/**
 * Sets a key result's current value, progress, confidence and last-check-in facts from the winning
 * check-in (see selectEffectiveCheckIn) and bumps its version. Check-in rows are never modified.
 * With `expectedVersion`, the update only applies to that version and throws a 409 otherwise.
 * A key result without any check-ins keeps its stored value; progress is still rescored.
 */
export async function recomputeKeyResultFromCheckIns(
  transaction: Transaction,
  keyResultId: string,
  companyId: string,
  expectedVersion?: number,
) {
  const [keyResult] = await transaction.select().from(keyResults)
    .where(and(eq(keyResults.id, keyResultId), eq(keyResults.companyId, companyId)))
    .limit(1);
  if (!keyResult) throw new InputError("Key result not found in this workspace.", 404);
  const history = await transaction.select().from(krCheckIns)
    .where(and(eq(krCheckIns.keyResultId, keyResultId), eq(krCheckIns.companyId, companyId)));
  const winner = selectEffectiveCheckIn(history);
  const current = winner ? Number(winner.value) : Number(keyResult.current);
  let progress: number;
  try {
    progress = calculateProgress(Number(keyResult.baseline), Number(keyResult.target), current, keyResult.direction, keyResult.metricType);
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : "Invalid key result values.");
  }

  const [updated] = await transaction.update(keyResults).set({
    current: current.toString(),
    progress: progress.toFixed(2),
    ...(winner ? {
      confidence: winner.confidence,
      lastEffectiveDate: winner.effectiveDate,
      lastCheckInAt: winner.createdAt,
    } : {}),
    version: sql`${keyResults.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(keyResults.id, keyResultId),
    eq(keyResults.companyId, companyId),
    ...(expectedVersion === undefined ? [] : [eq(keyResults.version, expectedVersion)]),
  )).returning();
  if (!updated) throw new InputError("Someone else updated this key result — refresh and try again.", 409);
  return { keyResult: updated, effectiveCheckIn: winner };
}
