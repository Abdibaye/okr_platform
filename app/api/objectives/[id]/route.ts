import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import {
  assertActiveMembers,
  assertActiveTeam,
  assertConsistentGoal,
  assertValidParent,
  canEditObjective,
  canManagePrivacy,
  canViewObjective,
  InputError,
  loadObjectiveAccessFacts,
  parseObjectiveInput,
  replaceObjectiveAccess,
  viewerFromContext,
} from "@/server/objectives";
import { recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { keyResults, objectives, okrCycles } from "@/server/schema";

const AUDITED_FIELDS = [
  ["ownerId", "objective_owner_changed", "owner"],
  ["status", "objective_status_changed", "status"],
  ["parentObjectiveId", "objective_parent_changed", "aligned parent"],
  ["visibility", "objective_visibility_changed", "privacy"],
] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Goal not found.", 404);

  const body = await readJson(request);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (!body || !Number.isSafeInteger(version) || (version as number) < 1) {
    return errorResponse("Include the current goal version to save your changes.", 400);
  }
  if (body.archived !== undefined && body.archived !== true) return errorResponse("Archived goals cannot be restored here.", 400);

  const actorId = context.session.user.id;
  const viewer = viewerFromContext(context);
  try {
    const input = parseObjectiveInput(body);
    const archiving = body.archived === true;
    if (!archiving && !Object.keys(input).length) return errorResponse("Provide a change to save.", 400);

    const result = await getDb().transaction(async (transaction) => {
      const [current] = await transaction.select({ objective: objectives, cycleStatus: okrCycles.status })
        .from(objectives)
        .innerJoin(okrCycles, eq(okrCycles.id, objectives.cycleId))
        .where(and(eq(objectives.id, id), eq(objectives.companyId, context.companyId), isNull(objectives.archivedAt)))
        .for("update", { of: objectives })
        .limit(1);
      if (!current) throw new InputError("Goal not found.", 404);
      const objective = current.objective;
      const facts = await loadObjectiveAccessFacts(transaction, context.companyId, id, objective.ownerId);
      if (!canViewObjective(objective, viewer, facts.ownerManagerId, facts.accessUserIds)) throw new InputError("Goal not found.", 404);
      if (current.cycleStatus === "closed") throw new InputError("This cycle is closed; goals cannot be changed.", 403);
      if (objective.version !== version) {
        return NextResponse.json({
          error: "This goal changed elsewhere. Reload to see the latest version before saving.",
          version: objective.version,
          title: objective.title,
          description: objective.description,
        }, { status: 409 });
      }
      if (!canEditObjective(objective, viewer, facts.editorIds)) throw new InputError("You do not have permission to edit this goal.", 403);
      const managesPrivacy = canManagePrivacy(objective, viewer);
      const touchesPrivacy = input.ownerId !== undefined || input.visibility !== undefined || input.viewerIds !== undefined || input.editorIds !== undefined;
      if ((touchesPrivacy || archiving) && !managesPrivacy) {
        throw new InputError("Only the goal owner, managers and admins can change ownership, privacy or archive a goal.", 403);
      }
      if (input.level === "company" && objective.level !== "company" && !hasRole(context.role, ["admin", "manager"])) {
        throw new InputError("Only managers and admins can create company goals.", 403);
      }

      if (archiving) {
        const [archived] = await transaction.update(objectives).set({
          archivedAt: new Date(),
          version: objective.version + 1,
          updatedAt: new Date(),
        }).where(eq(objectives.id, id)).returning();
        // Children stay in the cycle but are no longer aligned to an archived goal.
        await transaction.update(objectives).set({ parentObjectiveId: null, updatedAt: new Date() })
          .where(and(eq(objectives.companyId, context.companyId), eq(objectives.parentObjectiveId, id)));
        await transaction.update(keyResults).set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(keyResults.objectiveId, id), isNull(keyResults.archivedAt)));
        await recordAudit(transaction, {
          companyId: context.companyId,
          cycleId: objective.cycleId,
          actorId,
          action: "objective_archived",
          entityType: "objective",
          entityId: id,
          reason: `Archived goal "${objective.title}"`,
        });
        return { objective: archived };
      }

      const next = {
        level: input.level ?? objective.level,
        teamId: input.teamId !== undefined ? input.teamId : objective.teamId,
        visibility: input.visibility ?? objective.visibility,
      };
      assertConsistentGoal(next);
      if (input.ownerId) await assertActiveMembers(transaction, context.companyId, [input.ownerId], "The goal owner");
      await assertActiveMembers(transaction, context.companyId, [...(input.viewerIds ?? []), ...(input.editorIds ?? [])], "People given access");
      if (input.teamId && input.teamId !== objective.teamId) await assertActiveTeam(transaction, context.companyId, input.teamId);
      if (input.parentObjectiveId && input.parentObjectiveId !== objective.parentObjectiveId) {
        await assertValidParent(transaction, context.companyId, objective.cycleId, id, input.parentObjectiveId);
      }

      const { viewerIds, editorIds, ...fields } = input;
      const [updated] = await transaction.update(objectives).set({
        ...fields,
        version: objective.version + 1,
        updatedAt: new Date(),
      }).where(eq(objectives.id, id)).returning();
      await replaceObjectiveAccess(transaction, context.companyId, id, viewerIds, editorIds);

      for (const [field, action, label] of AUDITED_FIELDS) {
        const before = objective[field];
        const after = fields[field];
        if (after === undefined || after === before) continue;
        await recordAudit(transaction, {
          companyId: context.companyId,
          cycleId: objective.cycleId,
          actorId,
          action,
          entityType: "objective",
          entityId: id,
          reason: `Changed ${label} of "${updated.title}"`,
          details: { from: before, to: after },
        });
      }
      if (viewerIds !== undefined || editorIds !== undefined) {
        await recordAudit(transaction, {
          companyId: context.companyId,
          cycleId: objective.cycleId,
          actorId,
          action: "objective_access_changed",
          entityType: "objective",
          entityId: id,
          reason: `Updated additional access for "${updated.title}"`,
          details: { viewerIds: viewerIds ?? null, editorIds: editorIds ?? null },
        });
      }
      return { objective: updated };
    });
    if (isResponse(result)) return result;
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
