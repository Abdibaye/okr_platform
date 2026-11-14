import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import {
  canEditObjective,
  canViewObjective,
  InputError,
  loadObjectiveAccessFacts,
  notify,
  viewerFromContext,
} from "@/server/objectives";
import { recordAudit } from "@/server/people";
import { companyMemberships, objectives, okrCycles } from "@/server/schema";

const ACTIONS = {
  submit: { from: ["not_required", "changes_requested"], to: "pending", audit: "objective_approval_submitted", verb: "submitted for approval" },
  approve: { from: ["pending"], to: "approved", audit: "objective_approved", verb: "approved" },
  request_changes: { from: ["pending"], to: "changes_requested", audit: "objective_changes_requested", verb: "sent back with requested changes" },
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Goal not found.", 404);

  const body = await readJson(request);
  const actionName = body?.action;
  if (actionName !== "submit" && actionName !== "approve" && actionName !== "request_changes") {
    return errorResponse("Choose submit, approve or request changes.", 400);
  }
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > 2000) return errorResponse("Approval notes must be 2,000 characters or fewer.", 400);
  if (actionName === "request_changes" && !note) return errorResponse("Explain what needs to change.", 400);
  const action = ACTIONS[actionName];
  const actorId = context.session.user.id;
  const viewer = viewerFromContext(context);

  try {
    const objective = await getDb().transaction(async (transaction) => {
      const [current] = await transaction.select({ objective: objectives, cycleStatus: okrCycles.status })
        .from(objectives)
        .innerJoin(okrCycles, eq(okrCycles.id, objectives.cycleId))
        .where(and(eq(objectives.id, id), eq(objectives.companyId, context.companyId), isNull(objectives.archivedAt)))
        .for("update", { of: objectives })
        .limit(1);
      if (!current) throw new InputError("Goal not found.", 404);
      const goal = current.objective;
      const facts = await loadObjectiveAccessFacts(transaction, context.companyId, id, goal.ownerId);
      if (!canViewObjective(goal, viewer, facts.ownerManagerId, facts.accessUserIds)) throw new InputError("Goal not found.", 404);
      if (current.cycleStatus === "closed") throw new InputError("This cycle is closed; approvals cannot change.", 403);

      const isApprover = context.role === "admin" || (facts.ownerManagerId !== null && facts.ownerManagerId === actorId);
      if (actionName === "submit" && !canEditObjective(goal, viewer, facts.editorIds)) {
        throw new InputError("Only the goal owner, editors, managers and admins can submit a goal for approval.", 403);
      }
      if (actionName !== "submit" && !isApprover) {
        throw new InputError("Only the goal owner's manager or an admin can review this goal.", 403);
      }
      if (!(action.from as readonly string[]).includes(goal.approvalStatus)) {
        throw new InputError(`This goal is ${goal.approvalStatus.replace("_", " ")}; it cannot be ${action.verb} right now.`, 409);
      }

      const [updated] = await transaction.update(objectives).set({
        approvalStatus: action.to,
        approvedBy: actionName === "approve" ? actorId : null,
        approvedAt: actionName === "approve" ? new Date() : null,
        version: goal.version + 1,
        updatedAt: new Date(),
      }).where(eq(objectives.id, id)).returning();

      await recordAudit(transaction, {
        companyId: context.companyId,
        cycleId: goal.cycleId,
        actorId,
        action: action.audit,
        entityType: "objective",
        entityId: id,
        reason: note || `Goal "${goal.title}" ${action.verb}`,
        details: { from: goal.approvalStatus, to: action.to },
      });

      // Submissions go to the owner's manager (or admins if there is none); decisions go back to the owner.
      let recipients: string[] = [];
      if (actionName === "submit") {
        if (facts.ownerManagerId) recipients = [facts.ownerManagerId];
        else {
          const admins = await transaction.select({ userId: companyMemberships.userId }).from(companyMemberships).where(and(
            eq(companyMemberships.companyId, context.companyId),
            eq(companyMemberships.role, "admin"),
            eq(companyMemberships.isActive, true),
          ));
          recipients = admins.map((row) => row.userId);
        }
      } else if (goal.ownerId) {
        recipients = [goal.ownerId];
      }
      for (const recipientId of new Set(recipients)) {
        if (recipientId === actorId) continue;
        await notify(transaction, {
          companyId: context.companyId,
          recipientId,
          actorId,
          title: `"${goal.title}" was ${action.verb}`,
          body: note,
          objectiveId: id,
          dedupKey: `approval:${id}:${updated.version}`,
        });
      }
      return updated;
    });
    return NextResponse.json({ objective });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
