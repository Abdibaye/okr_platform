import { and, eq, exists } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { keyResults, objectives, okrCycles } from "@/server/schema";
import { calculateProgress } from "@/server/okr-math";
import { refreshObjectiveProgress } from "@/server/okr-mutations";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Key result not found in this workspace.", 404);

  const body = await readJson(request);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    return errorResponse("Include the current key result version to save your changes.", 400);
  }

  const hasCurrent = body?.current !== undefined;
  const hasTitle = typeof body?.title === "string";
  if (!hasCurrent && !hasTitle) {
    return errorResponse("Provide a current value or title to update.", 400);
  }
  const nextCurrent = hasCurrent ? (typeof body?.current === "number" ? body.current : Number.NaN) : undefined;
  if (hasCurrent && !Number.isFinite(nextCurrent)) {
    return errorResponse("Provide a valid numeric current value.", 400);
  }
  let nextTitle: string | undefined;
  if (hasTitle) {
    nextTitle = (body?.title as string).trim();
    if (!nextTitle || nextTitle.length > 240) {
      return errorResponse("Key result title must be 1–240 characters.", 400);
    }
  }

  const database = getDb();
  const outcome = await database.transaction(async (transaction) => {
    const [existing] = await transaction.select({
      baseline: keyResults.baseline,
      target: keyResults.target,
      current: keyResults.current,
      metricType: keyResults.metricType,
      direction: keyResults.direction,
      objectiveId: keyResults.objectiveId,
      cycleStatus: okrCycles.status,
    }).from(keyResults)
      .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, context.companyId)))
      .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, context.companyId)))
      .where(and(eq(keyResults.id, id), eq(keyResults.companyId, context.companyId)))
      .limit(1);

    if (!existing) return { status: 404 as const, error: "Key result not found in this workspace." };
    if (existing.cycleStatus === "closed") {
      return { status: 403 as const, error: "This cycle is closed; key results cannot be changed." };
    }
    if (existing.cycleStatus !== "open") {
      return { status: 403 as const, error: "Open the cycle before updating key results." };
    }

    const effectiveCurrent = nextCurrent ?? Number(existing.current);
    let progress: number;
    try {
      progress = calculateProgress(
        Number(existing.baseline),
        Number(existing.target),
        effectiveCurrent,
        existing.direction,
        existing.metricType,
      );
    } catch (error) {
      return { status: 400 as const, error: error instanceof Error ? error.message : "Invalid key result values." };
    }

    const updates: {
      current?: string;
      progress?: string;
      title?: string;
      version: number;
      updatedAt: Date;
    } = {
      version: (version as number) + 1,
      updatedAt: new Date(),
    };
    if (hasCurrent) {
      updates.current = effectiveCurrent.toString();
      updates.progress = progress.toFixed(2);
    }
    if (nextTitle !== undefined) {
      updates.title = nextTitle;
    }

    const [updated] = await transaction.update(keyResults).set(updates).where(and(
      eq(keyResults.id, id),
      eq(keyResults.companyId, context.companyId),
      eq(keyResults.version, version as number),
      exists(transaction.select({ id: okrCycles.id }).from(objectives)
        .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, context.companyId)))
        .where(and(
          eq(objectives.id, keyResults.objectiveId),
          eq(objectives.companyId, context.companyId),
          eq(okrCycles.status, "open"),
        ))),
    )).returning();

    if (!updated) {
      const [latest] = await transaction.select({
        version: keyResults.version,
        current: keyResults.current,
        title: keyResults.title,
        cycleStatus: okrCycles.status,
      }).from(keyResults)
        .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, context.companyId)))
        .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, context.companyId)))
        .where(and(eq(keyResults.id, id), eq(keyResults.companyId, context.companyId)))
        .limit(1);
      if (!latest) return { status: 404 as const, error: "Key result not found in this workspace." };
      if (latest.cycleStatus === "closed") {
        return { status: 403 as const, error: "This cycle is closed; key results cannot be changed." };
      }
      if (latest.cycleStatus !== "open") {
        return { status: 403 as const, error: "Open the cycle before updating key results." };
      }
      return {
        status: 409 as const,
        error: "This key result changed elsewhere. Reload before saving.",
        version: latest.version,
        current: latest.current,
        title: latest.title,
      };
    }

    if (hasCurrent) {
      await refreshObjectiveProgress(transaction, existing.objectiveId, context.companyId);
    }
    return { status: 200 as const, keyResult: updated };
  });

  if (outcome.status === 200) {
    return NextResponse.json({ keyResult: outcome.keyResult });
  }
  if (outcome.status === 409) {
    return NextResponse.json(
      {
        error: outcome.error,
        version: outcome.version,
        current: outcome.current,
        title: outcome.title,
      },
      { status: 409 },
    );
  }
  return errorResponse(outcome.error, outcome.status);
}
