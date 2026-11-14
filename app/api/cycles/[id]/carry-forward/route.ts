import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { calculateProgress } from "@/server/okr-math";
import { refreshObjectiveProgress } from "@/server/okr-mutations";
import { recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { keyResultEditors, keyResults, objectiveAccess, objectives, okrCycles } from "@/server/schema";

const MAX_GOALS = 500;

/** Goals that still have work left: draft/active, or progress below 100 (unmeasured goals count as unfinished). */
function isUnfinished(goal: { status: string; progress: string | null }) {
  if (goal.status === "draft" || goal.status === "active") return true;
  return goal.progress === null || Number(goal.progress) < 100;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can carry goals forward.", 403);

  const { id: sourceCycleId } = await params;
  if (!isUuid(sourceCycleId)) return errorResponse("Cycle not found.", 404);

  const body = await readJson(request);
  const targetCycleId = typeof body?.targetCycleId === "string" ? body.targetCycleId : "";
  const baselineMode = body?.baselineMode ?? "keep";
  const objectiveIds = Array.isArray(body?.objectiveIds) ? [...new Set(body.objectiveIds)] : null;
  if (!isUuid(targetCycleId)) return errorResponse("Choose a target cycle.", 400);
  if (targetCycleId === sourceCycleId) return errorResponse("Choose a different cycle to carry goals into.", 400);
  if (baselineMode !== "keep" && baselineMode !== "current_as_baseline") return errorResponse("Choose how baselines should carry forward.", 400);
  if (!objectiveIds || !objectiveIds.length || objectiveIds.length > MAX_GOALS || !objectiveIds.every((value) => typeof value === "string" && isUuid(value))) {
    return errorResponse("Select at least one goal to carry forward.", 400);
  }
  const selectedIds = objectiveIds as string[];
  const actorId = context.session.user.id;

  try {
    const result = await getDb().transaction(async (transaction) => {
      const cycles = await transaction.select().from(okrCycles).where(and(
        eq(okrCycles.companyId, context.companyId),
        inArray(okrCycles.id, [sourceCycleId, targetCycleId]),
      )).for("update");
      const source = cycles.find((cycle) => cycle.id === sourceCycleId);
      const target = cycles.find((cycle) => cycle.id === targetCycleId);
      if (!source) return errorResponse("Cycle not found.", 404);
      if (!target) return errorResponse("Target cycle not found.", 404);
      if (target.status === "closed") return errorResponse("The target cycle is closed; choose a draft or open cycle.", 403);

      const goals = await transaction.select().from(objectives).where(and(
        eq(objectives.companyId, context.companyId),
        eq(objectives.cycleId, sourceCycleId),
        inArray(objectives.id, selectedIds),
        isNull(objectives.archivedAt),
      ));
      if (goals.length !== selectedIds.length) return errorResponse("Some selected goals are not in this cycle.", 400);
      const finished = goals.filter((goal) => !isUnfinished(goal));
      if (finished.length) {
        return errorResponse(`Only unfinished goals can be carried forward ("${finished[0].title}" is complete).`, 400);
      }

      const krs = await transaction.select().from(keyResults).where(and(
        eq(keyResults.companyId, context.companyId),
        inArray(keyResults.objectiveId, selectedIds),
        isNull(keyResults.archivedAt),
      ));
      const access = await transaction.select().from(objectiveAccess).where(inArray(objectiveAccess.objectiveId, selectedIds));
      const krEditors = krs.length
        ? await transaction.select().from(keyResultEditors).where(inArray(keyResultEditors.keyResultId, krs.map((kr) => kr.id)))
        : [];

      // Insert clones first, then remap parent links that point inside the carried set.
      const cloneIdBySource = new Map<string, string>();
      for (const goal of goals) {
        const [clone] = await transaction.insert(objectives).values({
          companyId: context.companyId,
          cycleId: targetCycleId,
          title: goal.title,
          description: goal.description,
          progress: null,
          level: goal.level,
          teamId: goal.teamId,
          ownerId: goal.ownerId,
          dueDate: null,
          status: "active",
          approvalStatus: target.requireApproval ? "pending" : "not_required",
          visibility: goal.visibility,
          parentObjectiveId: null,
          copiedFromObjectiveId: goal.id,
          createdBy: actorId,
        }).returning({ id: objectives.id });
        cloneIdBySource.set(goal.id, clone.id);
      }

      for (const goal of goals) {
        const parentClone = goal.parentObjectiveId ? cloneIdBySource.get(goal.parentObjectiveId) : undefined;
        if (parentClone) {
          await transaction.update(objectives).set({ parentObjectiveId: parentClone })
            .where(eq(objectives.id, cloneIdBySource.get(goal.id)!));
        }
      }

      const accessRows = access.map((row) => ({
        companyId: context.companyId,
        objectiveId: cloneIdBySource.get(row.objectiveId)!,
        userId: row.userId,
        permission: row.permission,
      }));
      if (accessRows.length) await transaction.insert(objectiveAccess).values(accessRows);

      for (const kr of krs) {
        // "keep" carries baseline, target and the measured value; "current_as_baseline" restarts from today's value.
        // A key result that already hit its target keeps its original baseline (its current value cannot be a new start).
        const restart = baselineMode === "current_as_baseline" && Number(kr.progress) < 100;
        const baseline = restart ? Number(kr.current) : Number(kr.baseline);
        const current = Number(kr.current);
        const target = Number(kr.target);
        if (baseline === target) {
          throw new CarryForwardError(`"${kr.title}" has already reached its target, so its current value cannot become the new baseline. Use "Keep baseline" or finish that key result.`);
        }
        let progress: number;
        try {
          progress = calculateProgress(baseline, target, current, kr.direction, kr.metricType);
        } catch (error) {
          throw new CarryForwardError(`"${kr.title}": ${error instanceof Error ? error.message : "invalid metric values"}.`);
        }
        const [clone] = await transaction.insert(keyResults).values({
          companyId: context.companyId,
          objectiveId: cloneIdBySource.get(kr.objectiveId)!,
          title: kr.title,
          metricType: kr.metricType,
          direction: kr.direction,
          unit: kr.unit,
          baseline: String(baseline),
          target: kr.target,
          current: String(current),
          progress: progress.toFixed(2),
          ownerId: kr.ownerId,
        }).returning({ id: keyResults.id });
        const editors = krEditors.filter((row) => row.keyResultId === kr.id);
        if (editors.length) {
          await transaction.insert(keyResultEditors).values(editors.map((row) => ({ companyId: context.companyId, keyResultId: clone.id, userId: row.userId })));
        }
      }

      for (const cloneId of cloneIdBySource.values()) {
        await refreshObjectiveProgress(transaction, cloneId, context.companyId);
      }

      await recordAudit(transaction, {
        companyId: context.companyId,
        cycleId: targetCycleId,
        actorId,
        action: "cycle_carry_forward",
        entityType: "cycle",
        entityId: targetCycleId,
        reason: `Carried ${goals.length} goal${goals.length === 1 ? "" : "s"} from ${source.name} to ${target.name}`,
        details: {
          sourceCycleId,
          targetCycleId,
          baselineMode,
          goals: goals.map((goal) => ({ from: goal.id, to: cloneIdBySource.get(goal.id) })),
          keyResults: krs.length,
        },
      });
      return { carried: goals.length, keyResults: krs.length, objectiveIds: [...cloneIdBySource.values()] };
    });
    if (isResponse(result)) return result;
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CarryForwardError) return errorResponse(error.message, 400);
    throw error;
  }
}

class CarryForwardError extends Error {}
