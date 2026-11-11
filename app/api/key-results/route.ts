import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { keyResults, objectives, okrCycles } from "@/server/schema";
import { calculateProgress } from "@/server/okr-math";
import { refreshObjectiveProgress } from "@/server/okr-mutations";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const objectiveId = typeof body?.objectiveId === "string" ? body.objectiveId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const metricType = body?.metricType;
  const direction = body?.direction;
  const unit = typeof body?.unit === "string" ? body.unit.trim() : "";
  const baseline = typeof body?.baseline === "number" ? body.baseline : Number.NaN;
  const target = typeof body?.target === "number" ? body.target : Number.NaN;
  const current = typeof body?.current === "number" ? body.current : baseline;
  if (!objectiveId || !isUuid(objectiveId) || !title || title.length > 240 || unit.length > 24) {
    return errorResponse("Provide a key result title and valid objective.", 400);
  }
  if (metricType !== "numeric" && metricType !== "percentage" && metricType !== "currency" && metricType !== "binary") {
    return errorResponse("Choose a valid metric type.", 400);
  }
  if (direction !== "increasing" && direction !== "decreasing") {
    return errorResponse("Choose a valid metric direction.", 400);
  }
  let progress: number;
  try {
    progress = calculateProgress(baseline, target, current, direction, metricType);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Invalid key result values.", 400);
  }

  const database = getDb();
  const [objective] = await database.select({
    id: objectives.id,
    cycleStatus: okrCycles.status,
  }).from(objectives)
    .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, context.companyId)))
    .where(and(eq(objectives.id, objectiveId), eq(objectives.companyId, context.companyId)))
    .limit(1);
  if (!objective) return errorResponse("Objective not found in this workspace.", 404);
  if (objective.cycleStatus === "closed") return errorResponse("This cycle is closed; key results cannot be added.", 403);
  if (objective.cycleStatus !== "open") return errorResponse("Open the cycle before adding key results.", 403);

  const [keyResult] = await database.transaction(async (transaction) => {
    const [created] = await transaction.insert(keyResults).values({
      companyId: context.companyId,
      objectiveId,
      title,
      metricType,
      direction,
      unit,
      baseline: baseline.toString(),
      target: target.toString(),
      current: current.toString(),
      progress: progress.toFixed(2),
    }).returning();
    await refreshObjectiveProgress(transaction, objectiveId, context.companyId);
    return [created];
  });
  return NextResponse.json({ keyResult }, { status: 201 });
}
