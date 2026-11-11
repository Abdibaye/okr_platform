import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { keyResults, objectives, okrCycles } from "@/server/schema";
import { calculateProgress } from "@/server/okr-math";
import { refreshObjectiveProgress } from "@/server/okr-mutations";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  const body = await readJson(request);
  const current = typeof body?.current === "number" ? body.current : Number.NaN;
  if (!Number.isFinite(current)) return errorResponse("Provide a numeric current value.", 400);

  const database = getDb();
  const [existing] = await database.select({
    baseline: keyResults.baseline,
    target: keyResults.target,
    metricType: keyResults.metricType,
    direction: keyResults.direction,
    objectiveId: keyResults.objectiveId,
    cycleStatus: okrCycles.status,
  }).from(keyResults)
    .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, context.companyId)))
    .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, context.companyId)))
    .where(and(eq(keyResults.id, id), eq(keyResults.companyId, context.companyId)))
    .limit(1);
  if (!existing) return errorResponse("Key result not found in this workspace.", 404);
  if (existing.cycleStatus === "closed") {
    return errorResponse("This cycle is closed; key results cannot be changed.", 403);
  }

  let progress: number;
  try {
    progress = calculateProgress(Number(existing.baseline), Number(existing.target), current, existing.direction, existing.metricType);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Invalid key result values.", 400);
  }

  const [updated] = await database.transaction(async (transaction) => {
    const [row] = await transaction.update(keyResults).set({
      current: current.toString(),
      progress: progress.toFixed(2),
      updatedAt: new Date(),
    }).where(and(eq(keyResults.id, id), eq(keyResults.companyId, context.companyId))).returning();
    await refreshObjectiveProgress(transaction, existing.objectiveId, context.companyId);
    return [row];
  });
  return NextResponse.json({ keyResult: updated });
}
