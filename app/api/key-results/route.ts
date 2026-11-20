import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { deliverNotificationEmails, notifyNewOwners } from "@/server/notifications";
import { keyResults, krCheckIns, objectives, okrCycles } from "@/server/schema";
import { calculateProgress } from "@/server/okr-math";
import { refreshObjectiveProgress, todayWithinCycle } from "@/server/okr-mutations";
import {
  assertActiveMembers,
  canEditObjective,
  canViewObjective,
  InputError,
  loadObjectiveAccessFacts,
  parseKeyResultInput,
  replaceKeyResultEditors,
  viewerFromContext,
} from "@/server/objectives";
import { recordAudit } from "@/server/people";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const objectiveId = typeof body?.objectiveId === "string" ? body.objectiveId : "";
  if (!body || !isUuid(objectiveId)) return errorResponse("Provide a key result title and valid goal.", 400);

  const actorId = context.session.user.id;
  const actorName = context.session.user.name || "Someone";
  try {
    const input = parseKeyResultInput(body);
    if (!input.title) throw new InputError("Provide a key result title.");
    if (!input.metricType) throw new InputError("Choose a valid metric type.");
    if (!input.direction) throw new InputError("Choose a valid metric direction.");
    if (input.baseline === undefined || input.target === undefined) throw new InputError("Provide a baseline and target.");
    const current = input.current ?? input.baseline;
    let progress: number;
    try {
      progress = calculateProgress(input.baseline, input.target, current, input.direction, input.metricType);
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : "Invalid key result values.");
    }

    const result = await getDb().transaction(async (transaction) => {
      const [row] = await transaction.select({ objective: objectives, cycleStatus: okrCycles.status, cycleStartDate: okrCycles.startDate, cycleEndDate: okrCycles.endDate })
        .from(objectives)
        .innerJoin(okrCycles, eq(okrCycles.id, objectives.cycleId))
        .where(and(eq(objectives.id, objectiveId), eq(objectives.companyId, context.companyId), isNull(objectives.archivedAt)))
        .limit(1);
      if (!row) throw new InputError("Goal not found in this workspace.", 404);
      const viewer = viewerFromContext(context);
      const facts = await loadObjectiveAccessFacts(transaction, context.companyId, objectiveId, row.objective.ownerId);
      if (!canViewObjective(row.objective, viewer, facts)) throw new InputError("Goal not found in this workspace.", 404);
      if (row.cycleStatus === "closed") throw new InputError("This cycle is closed; key results cannot be added.", 403);
      // Unowned legacy goals stay open to any member who can see them.
      if (row.objective.ownerId && !canEditObjective(row.objective, viewer, facts)) {
        throw new InputError("Only the goal owner, editors, managers and admins can add key results.", 403);
      }
      const ownerId = input.ownerId === undefined ? row.objective.ownerId : input.ownerId;
      if (ownerId) await assertActiveMembers(transaction, context.companyId, [ownerId], "The key result owner");
      await assertActiveMembers(transaction, context.companyId, input.editorIds ?? [], "Key result editors");

      const [created] = await transaction.insert(keyResults).values({
        companyId: context.companyId,
        objectiveId,
        title: input.title!,
        metricType: input.metricType!,
        direction: input.direction!,
        unit: input.unit ?? "",
        baseline: input.baseline!.toString(),
        target: input.target!.toString(),
        current: current.toString(),
        progress: progress.toFixed(2),
        ownerId,
        dueDate: input.dueDate ?? null,
      }).returning();
      if (input.editorIds?.length) await replaceKeyResultEditors(transaction, context.companyId, created.id, input.editorIds);
      // Every key result starts its ledger with the value it was created at.
      const effectiveDate = todayWithinCycle({ startDate: row.cycleStartDate, endDate: row.cycleEndDate });
      const [initial] = await transaction.insert(krCheckIns).values({
        companyId: context.companyId,
        cycleId: row.objective.cycleId,
        objectiveId,
        keyResultId: created.id,
        authorId: actorId,
        effectiveDate,
        value: created.current,
        progress: created.progress,
        confidence: created.confidence,
        note: "Initial value",
      }).returning({ createdAt: krCheckIns.createdAt });
      const [withCheckIn] = await transaction.update(keyResults)
        .set({ lastEffectiveDate: effectiveDate, lastCheckInAt: initial.createdAt })
        .where(eq(keyResults.id, created.id))
        .returning();
      await refreshObjectiveProgress(transaction, objectiveId, context.companyId);
      await recordAudit(transaction, {
        companyId: context.companyId,
        cycleId: row.objective.cycleId,
        actorId,
        action: "key_result_created",
        entityType: "key_result",
        entityId: created.id,
        reason: `Added key result "${created.title}" to "${row.objective.title}"`,
        details: { objectiveId, baseline: created.baseline, target: created.target, ownerId },
      });
      const notified = ownerId
        ? await notifyNewOwners(transaction, context.companyId, actorId, actorName, "created", [{
          recipientId: ownerId, objectiveId, goalTitle: row.objective.title, keyResultId: created.id, keyResultTitle: created.title,
        }])
        : [];
      return { keyResult: withCheckIn, notified };
    });
    await deliverNotificationEmails(result.notified);
    return NextResponse.json({ keyResult: result.keyResult }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
