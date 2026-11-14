import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { keyResultEditors, keyResults, krCheckIns, objectives, okrCycles } from "@/server/schema";
import { calculateProgress } from "@/server/okr-math";
import { recomputeKeyResultFromCheckIns, refreshObjectiveProgress, todayWithinCycle } from "@/server/okr-mutations";
import {
  assertActiveMembers,
  canEditKeyResult,
  canEditObjective,
  canViewObjective,
  InputError,
  loadObjectiveAccessFacts,
  parseKeyResultInput,
  replaceKeyResultEditors,
  viewerFromContext,
} from "@/server/objectives";
import { recordAudit } from "@/server/people";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Key result not found in this workspace.", 404);

  const body = await readJson(request);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (!body || !Number.isSafeInteger(version) || (version as number) < 1) {
    return errorResponse("Include the current key result version to save your changes.", 400);
  }
  if (body.archived !== undefined && body.archived !== true) return errorResponse("Archived key results cannot be restored here.", 400);

  const actorId = context.session.user.id;
  const viewer = viewerFromContext(context);
  try {
    const input = parseKeyResultInput(body);
    const archiving = body.archived === true;
    const changedKeys = Object.keys(input);
    if (!archiving && !changedKeys.length) return errorResponse("Provide a change to save.", 400);
    const checkInOnly = !archiving && changedKeys.every((key) => key === "current");

    const result = await getDb().transaction(async (transaction) => {
      const [row] = await transaction.select({ keyResult: keyResults, objective: objectives, cycleStatus: okrCycles.status, cycleStartDate: okrCycles.startDate, cycleEndDate: okrCycles.endDate })
        .from(keyResults)
        .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, context.companyId)))
        .innerJoin(okrCycles, eq(okrCycles.id, objectives.cycleId))
        .where(and(
          eq(keyResults.id, id),
          eq(keyResults.companyId, context.companyId),
          isNull(keyResults.archivedAt),
          isNull(objectives.archivedAt),
        ))
        .for("update", { of: keyResults })
        .limit(1);
      if (!row) throw new InputError("Key result not found in this workspace.", 404);
      const { keyResult, objective } = row;
      const facts = await loadObjectiveAccessFacts(transaction, context.companyId, objective.id, objective.ownerId);
      if (!canViewObjective(objective, viewer, facts)) throw new InputError("Key result not found in this workspace.", 404);
      if (row.cycleStatus === "closed") throw new InputError("This cycle is closed; key results cannot be changed.", 403);
      if (input.current !== undefined && row.cycleStatus !== "open") throw new InputError("Open the cycle before checking in on key results.", 403);
      if (keyResult.version !== version) {
        return NextResponse.json({
          error: "This key result changed elsewhere. Reload to see the latest values before saving.",
          version: keyResult.version,
          current: keyResult.current,
          title: keyResult.title,
        }, { status: 409 });
      }

      const krEditors = await transaction.select({ userId: keyResultEditors.userId }).from(keyResultEditors).where(eq(keyResultEditors.keyResultId, id));
      const goalEditor = canEditObjective(objective, viewer, facts);
      const unowned = !objective.ownerId && !keyResult.ownerId;
      // Named key result editors may only check in; content edits need the owner, their managers or a goal editor.
      const canCheckIn = canEditKeyResult(objective, keyResult, viewer, facts, krEditors.map((editor) => editor.userId));
      const canEditContent = canEditKeyResult(objective, keyResult, viewer, facts, []);
      if (checkInOnly ? !canCheckIn : !canEditContent) {
        throw new InputError("You do not have permission to update this key result.", 403);
      }
      if ((input.ownerId !== undefined || input.editorIds !== undefined) && !(goalEditor || unowned)) {
        throw new InputError("Only goal owners, editors, managers and admins can reassign key results.", 403);
      }

      if (archiving) {
        const [archived] = await transaction.update(keyResults).set({ archivedAt: new Date(), version: keyResult.version + 1, updatedAt: new Date() })
          .where(eq(keyResults.id, id)).returning();
        await refreshObjectiveProgress(transaction, objective.id, context.companyId);
        await recordAudit(transaction, {
          companyId: context.companyId,
          cycleId: objective.cycleId,
          actorId,
          action: "key_result_archived",
          entityType: "key_result",
          entityId: id,
          reason: `Archived key result "${keyResult.title}"`,
        });
        return { keyResult: archived };
      }

      if (input.ownerId) await assertActiveMembers(transaction, context.companyId, [input.ownerId], "The key result owner");
      if (input.editorIds) await assertActiveMembers(transaction, context.companyId, input.editorIds, "Key result editors");

      const next = {
        baseline: input.baseline ?? Number(keyResult.baseline),
        target: input.target ?? Number(keyResult.target),
        current: input.current ?? Number(keyResult.current),
        direction: input.direction ?? keyResult.direction,
        metricType: input.metricType ?? keyResult.metricType,
      };
      const metricChanged = ["baseline", "target", "current", "direction", "metricType"].some((key) => key in input);
      let progress: number | undefined;
      if (metricChanged) {
        try {
          progress = calculateProgress(next.baseline, next.target, next.current, next.direction, next.metricType);
        } catch (error) {
          throw new InputError(error instanceof Error ? error.message : "Invalid key result values.");
        }
      }

      // `current` and `progress` are never written directly: a new value is appended to the check-in ledger,
      // and any metric change re-derives them from the winning check-in (which also bumps the version).
      const { editorIds, baseline, target, current, ...fields } = input;
      let [updated] = await transaction.update(keyResults).set({
        ...fields,
        ...(baseline !== undefined ? { baseline: baseline.toString() } : {}),
        ...(target !== undefined ? { target: target.toString() } : {}),
        ...(metricChanged ? {} : { version: keyResult.version + 1 }),
        updatedAt: new Date(),
      }).where(eq(keyResults.id, id)).returning();
      if (editorIds) await replaceKeyResultEditors(transaction, context.companyId, id, editorIds);
      if (current !== undefined) {
        await transaction.insert(krCheckIns).values({
          companyId: context.companyId,
          cycleId: objective.cycleId,
          objectiveId: objective.id,
          keyResultId: id,
          authorId: actorId,
          effectiveDate: todayWithinCycle({ startDate: row.cycleStartDate, endDate: row.cycleEndDate }),
          value: current.toString(),
          progress: progress!.toFixed(2),
          confidence: keyResult.confidence,
          note: "Updated from the key result form",
        });
      }
      if (metricChanged) {
        updated = (await recomputeKeyResultFromCheckIns(transaction, id, context.companyId)).keyResult;
        await refreshObjectiveProgress(transaction, objective.id, context.companyId);
      }

      if ((baseline !== undefined && baseline !== Number(keyResult.baseline)) || (target !== undefined && target !== Number(keyResult.target))) {
        await recordAudit(transaction, {
          companyId: context.companyId,
          cycleId: objective.cycleId,
          actorId,
          action: "key_result_target_changed",
          entityType: "key_result",
          entityId: id,
          reason: `Changed baseline/target of "${updated.title}"`,
          details: {
            from: { baseline: keyResult.baseline, target: keyResult.target },
            to: { baseline: updated.baseline, target: updated.target },
          },
        });
      }
      if (input.ownerId !== undefined && input.ownerId !== keyResult.ownerId) {
        await recordAudit(transaction, {
          companyId: context.companyId,
          cycleId: objective.cycleId,
          actorId,
          action: "key_result_owner_changed",
          entityType: "key_result",
          entityId: id,
          reason: `Changed owner of "${updated.title}"`,
          details: { from: keyResult.ownerId, to: input.ownerId },
        });
      }
      return { keyResult: updated };
    });
    if (isResponse(result)) return result;
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
