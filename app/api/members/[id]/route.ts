import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { countActiveAdmins, createsReportingLoop, isRole, loadManagerMap, recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { companyMemberships, keyResults, objectives, teamMemberships, teams, user } from "@/server/schema";

class MemberUpdateError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/members/[id]">) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin"])) return errorResponse("Only admins can update members.", 403);
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Member not found.", 404);

  const body = await readJson(request);
  if (!body) return errorResponse("Provide the member changes to save.", 400);
  const actorId = context.session.user.id;

  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 160)) {
    return errorResponse("Name is required and must be 160 characters or fewer.", 400);
  }
  if (body.teamIds !== undefined && (!Array.isArray(body.teamIds) || body.teamIds.some((id) => typeof id !== "string" || !isUuid(id)))) {
    return errorResponse("Choose valid workspace teams.", 400);
  }

  if (body.role !== undefined && !isRole(body.role)) return errorResponse("Role must be admin, manager or member.", 400);
  if (body.managerId !== undefined && body.managerId !== null && typeof body.managerId !== "string") {
    return errorResponse("Manager must be a member id or null.", 400);
  }
  if (body.jobTitle !== undefined && (typeof body.jobTitle !== "string" || body.jobTitle.trim().length > 160)) {
    return errorResponse("Job title must be 160 characters or fewer.", 400);
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") return errorResponse("isActive must be true or false.", 400);
  if (body.reassignToUserId !== undefined && body.reassignToUserId !== null && typeof body.reassignToUserId !== "string") {
    return errorResponse("Reassignment target must be a member id.", 400);
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : "Member updated by admin";

  try {
    const result = await getDb().transaction(async (transaction) => {
      const [target] = await transaction.select().from(companyMemberships).where(and(
        eq(companyMemberships.id, id),
        eq(companyMemberships.companyId, context.companyId),
      )).limit(1).for("update");
      if (!target) throw new MemberUpdateError("Member not found.", 404);

      const memberships = await transaction.select({
        userId: companyMemberships.userId,
        isActive: companyMemberships.isActive,
      }).from(companyMemberships).where(eq(companyMemberships.companyId, context.companyId));
      const activeIds = new Set(memberships.filter((row) => row.isActive).map((row) => row.userId));

      const updates: Partial<typeof companyMemberships.$inferInsert> = {};
      const changes: Record<string, unknown> = {};
      let action = "member_updated";

      if (typeof body.name === "string") {
        const [account] = await transaction.select({ name: user.name }).from(user).where(eq(user.id, target.userId)).for("update");
        if (!account) throw new MemberUpdateError("Account not found.", 404);
        if (account.name !== body.name.trim()) {
          const [shared] = await transaction.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
            eq(companyMemberships.userId, target.userId), ne(companyMemberships.companyId, context.companyId),
          )).limit(1);
          if (shared) throw new MemberUpdateError("This account belongs to multiple workspaces. Its owner must change their shared account name.", 409);
          await transaction.update(user).set({ name: body.name.trim(), updatedAt: new Date() }).where(eq(user.id, target.userId));
          changes.name = { from: account.name, to: body.name.trim() };
        }
      }

      if (Array.isArray(body.teamIds)) {
        const requested = new Set(body.teamIds as string[]);
        const availableTeams = await transaction.select({ id: teams.id, leadUserId: teams.leadUserId }).from(teams).where(and(
          eq(teams.companyId, context.companyId), isNull(teams.archivedAt),
        )).for("update");
        if ([...requested].some((teamId) => !availableTeams.some((team) => team.id === teamId))) {
          throw new MemberUpdateError("Choose non-archived teams in this workspace.", 400);
        }
        const existing = await transaction.select({ teamId: teamMemberships.teamId }).from(teamMemberships).where(and(
          eq(teamMemberships.companyId, context.companyId), eq(teamMemberships.userId, target.userId),
        ));
        const existingIds = new Set(existing.map((entry) => entry.teamId));
        const added = [...requested].filter((teamId) => !existingIds.has(teamId));
        const removed = availableTeams.filter((team) => existingIds.has(team.id) && !requested.has(team.id)).map((team) => team.id);
        if (added.length && !(body.isActive ?? target.isActive)) throw new MemberUpdateError("Reactivate this user before adding them to a team.", 400);
        if (removed.length) {
          await transaction.delete(teamMemberships).where(and(eq(teamMemberships.companyId, context.companyId), eq(teamMemberships.userId, target.userId), inArray(teamMemberships.teamId, removed)));
          await transaction.update(teams).set({ leadUserId: null, updatedAt: new Date() }).where(and(eq(teams.companyId, context.companyId), eq(teams.leadUserId, target.userId), inArray(teams.id, removed)));
        }
        if (added.length) await transaction.insert(teamMemberships).values(added.map((teamId) => ({ companyId: context.companyId, userId: target.userId, teamId }))).onConflictDoNothing();
        if (added.length || removed.length) changes.teams = { added, removed };
      }

      if (body.role !== undefined && body.role !== target.role) {
        if (target.role === "admin" && target.isActive && await countActiveAdmins(transaction, context.companyId) <= 1) {
          throw new MemberUpdateError("Keep at least one active admin in the workspace.", 409);
        }
        updates.role = body.role as typeof target.role;
        changes.role = { from: target.role, to: body.role };
      }

      if (body.managerId !== undefined && body.managerId !== target.managerId) {
        const managerId = body.managerId as string | null;
        if (managerId !== null) {
          if (managerId === target.userId) throw new MemberUpdateError("A person cannot be their own manager.", 400);
          if (!activeIds.has(managerId)) throw new MemberUpdateError("Choose an active workspace member as manager.", 400);
          const managers = await loadManagerMap(transaction, context.companyId);
          if (createsReportingLoop(managers, target.userId, managerId)) {
            throw new MemberUpdateError("That manager reports to this person; reporting lines cannot loop.", 400);
          }
        }
        updates.managerId = managerId;
        changes.managerId = { from: target.managerId, to: managerId };
      }

      if (typeof body.jobTitle === "string" && body.jobTitle.trim() !== target.jobTitle) {
        updates.jobTitle = body.jobTitle.trim();
        changes.jobTitle = { from: target.jobTitle, to: updates.jobTitle };
      }

      let reassigned = { objectives: 0, keyResults: 0 };
      if (body.isActive === false && target.isActive) {
        if (target.userId === actorId) throw new MemberUpdateError("You cannot deactivate yourself.", 409);
        if (target.role === "admin" && await countActiveAdmins(transaction, context.companyId) <= 1) {
          throw new MemberUpdateError("Keep at least one active admin in the workspace.", 409);
        }
        const reassignTo = typeof body.reassignToUserId === "string" ? body.reassignToUserId : null;
        if (reassignTo) {
          if (reassignTo === target.userId || !activeIds.has(reassignTo)) {
            throw new MemberUpdateError("Reassign goals to a different active member.", 400);
          }
          const now = new Date();
          const movedObjectives = await transaction.update(objectives).set({ ownerId: reassignTo, updatedAt: now })
            .where(and(eq(objectives.companyId, context.companyId), eq(objectives.ownerId, target.userId)))
            .returning({ id: objectives.id });
          const movedResults = await transaction.update(keyResults).set({ ownerId: reassignTo, updatedAt: now })
            .where(and(eq(keyResults.companyId, context.companyId), eq(keyResults.ownerId, target.userId)))
            .returning({ id: keyResults.id });
          reassigned = { objectives: movedObjectives.length, keyResults: movedResults.length };
          changes.reassignedTo = reassignTo;
          changes.reassigned = reassigned;
        }
        updates.isActive = false;
        updates.deactivatedAt = new Date();
        action = "member_deactivated";
      } else if (body.isActive === true && !target.isActive) {
        updates.isActive = true;
        updates.deactivatedAt = null;
        action = "member_reactivated";
      }

      if (!Object.keys(updates).length && !Object.keys(changes).length) throw new MemberUpdateError("Nothing to change.", 400);
      updates.updatedAt = new Date();

      const [updated] = await transaction.update(companyMemberships).set(updates)
        .where(and(eq(companyMemberships.id, id), eq(companyMemberships.companyId, context.companyId)))
        .returning();

      await recordAudit(transaction, {
        companyId: context.companyId,
        actorId,
        action,
        entityType: "member",
        entityId: target.id,
        reason,
        details: { userId: target.userId, ...changes },
      });
      return { member: updated, reassigned };
    }, { isolationLevel: "serializable" });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MemberUpdateError) return errorResponse(error.message, error.status);
    throw error;
  }
}
