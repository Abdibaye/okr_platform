import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import {
  assertActiveMembers,
  assertActiveTeam,
  assertConsistentGoal,
  assertValidParent,
  InputError,
  parseObjectiveInput,
  replaceObjectiveAccess,
} from "@/server/objectives";
import { recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { objectives, okrCycles } from "@/server/schema";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const cycleId = typeof body?.cycleId === "string" ? body.cycleId : "";
  if (!body || !isUuid(cycleId)) return errorResponse("Provide a goal title and valid cycle.", 400);

  const actorId = context.session.user.id;
  const canManage = hasRole(context.role, ["admin", "manager"]);
  try {
    const input = parseObjectiveInput(body);
    if (!input.title) throw new InputError("Provide a goal title.");
    const level = input.level ?? (canManage ? "company" : "individual");
    const ownerId = input.ownerId === undefined ? actorId : input.ownerId;
    // Members may draft their own individual goals; company/team goals and assigning others need a manager.
    if (!canManage && (level !== "individual" || ownerId !== actorId)) {
      return errorResponse("Members can create individual goals that they own. Ask a manager for team or company goals.", 403);
    }
    const goal = {
      level,
      teamId: input.teamId ?? null,
      visibility: input.visibility ?? "company",
    };
    assertConsistentGoal(goal);

    const objective = await getDb().transaction(async (transaction) => {
      const [cycle] = await transaction.select({ status: okrCycles.status, requireApproval: okrCycles.requireApproval })
        .from(okrCycles)
        .where(and(eq(okrCycles.id, cycleId), eq(okrCycles.companyId, context.companyId)))
        .limit(1);
      if (!cycle) throw new InputError("Cycle not found.", 404);
      if (cycle.status === "closed") throw new InputError("This cycle is closed; goals cannot be created.", 403);

      if (ownerId) await assertActiveMembers(transaction, context.companyId, [ownerId], "The goal owner");
      await assertActiveMembers(transaction, context.companyId, [...(input.viewerIds ?? []), ...(input.editorIds ?? [])], "People given access");
      if (goal.teamId) await assertActiveTeam(transaction, context.companyId, goal.teamId);
      if (input.parentObjectiveId) await assertValidParent(transaction, context.companyId, cycleId, null, input.parentObjectiveId);

      const [created] = await transaction.insert(objectives).values({
        companyId: context.companyId,
        cycleId,
        title: input.title!,
        description: input.description ?? "",
        level,
        teamId: goal.teamId,
        ownerId,
        dueDate: input.dueDate ?? null,
        status: input.status ?? "active",
        approvalStatus: cycle.requireApproval ? "pending" : "not_required",
        visibility: goal.visibility,
        parentObjectiveId: input.parentObjectiveId ?? null,
        createdBy: actorId,
      }).returning();
      await replaceObjectiveAccess(transaction, context.companyId, created.id, input.viewerIds ?? [], input.editorIds ?? []);
      await recordAudit(transaction, {
        companyId: context.companyId,
        actorId,
        cycleId,
        action: "objective_created",
        entityType: "objective",
        entityId: created.id,
        reason: `Created goal "${created.title}"`,
        details: { level, ownerId, visibility: goal.visibility, parentObjectiveId: created.parentObjectiveId },
      });
      return created;
    });
    return NextResponse.json({ objective }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
