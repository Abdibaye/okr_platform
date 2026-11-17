import { and, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { companyMemberships, teamMemberships, teams } from "@/server/schema";

class TeamUpdateError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

function idList(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item) || value.length > 500) return null;
  return [...new Set(value as string[])];
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/teams/[id]">) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can update teams.", 403);
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Team not found.", 404);

  const body = await readJson(request);
  if (!body) return errorResponse("Provide the team changes to save.", 400);
  const addMemberIds = idList(body.addMemberIds);
  const removeMemberIds = idList(body.removeMemberIds);
  if (!addMemberIds || !removeMemberIds) return errorResponse("Member lists must be arrays of member ids.", 400);
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120)) {
    return errorResponse("Team name must be 1–120 characters.", 400);
  }
  if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000)) {
    return errorResponse("Description must be 2,000 characters or fewer.", 400);
  }
  if (body.leadUserId !== undefined && body.leadUserId !== null && typeof body.leadUserId !== "string") {
    return errorResponse("Team lead must be a member id or null.", 400);
  }
  if (body.archived !== undefined && typeof body.archived !== "boolean") return errorResponse("archived must be true or false.", 400);

  try {
    const team = await getDb().transaction(async (transaction) => {
      const [current] = await transaction.select().from(teams)
        .where(and(eq(teams.id, id), eq(teams.companyId, context.companyId)))
        .limit(1).for("update");
      if (!current) throw new TeamUpdateError("Team not found.", 404);

      const leadUserId = body.leadUserId === undefined ? undefined : (body.leadUserId as string | null) || null;
      const candidates = [...addMemberIds, ...(leadUserId ? [leadUserId] : [])];
      if (candidates.length) {
        const active = await transaction.select({ userId: companyMemberships.userId }).from(companyMemberships).where(and(
          eq(companyMemberships.companyId, context.companyId),
          eq(companyMemberships.isActive, true),
          inArray(companyMemberships.userId, candidates),
        ));
        const activeIds = new Set(active.map((row) => row.userId));
        if (candidates.some((userId) => !activeIds.has(userId))) {
          throw new TeamUpdateError("Team members and leads must be active workspace members.", 400);
        }
      }
      if (leadUserId && removeMemberIds.includes(leadUserId)) {
        throw new TeamUpdateError("The new team lead cannot also be removed from the team.", 400);
      }

      const updates: Partial<typeof teams.$inferInsert> = { updatedAt: new Date() };
      const changes: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim() !== current.name) {
        const name = body.name.trim();
        const [clash] = await transaction.select({ id: teams.id }).from(teams).where(and(
          eq(teams.companyId, context.companyId), eq(teams.name, name), ne(teams.id, id),
        )).limit(1);
        if (clash) throw new TeamUpdateError("A team with this name already exists (it may be archived).", 409);
        updates.name = name;
        changes.name = { from: current.name, to: name };
      }
      if (typeof body.description === "string") updates.description = body.description.trim();
      if (body.archived === false && current.archivedAt) {
        updates.archivedAt = null;
        changes.restored = true;
      }
      if (body.archived === true && !current.archivedAt) {
        updates.archivedAt = new Date();
        changes.archived = true;
      }

      if (removeMemberIds.length) {
        await transaction.delete(teamMemberships).where(and(
          eq(teamMemberships.companyId, context.companyId),
          eq(teamMemberships.teamId, id),
          inArray(teamMemberships.userId, removeMemberIds),
        ));
        changes.removedMemberIds = removeMemberIds;
        if (current.leadUserId && removeMemberIds.includes(current.leadUserId) && leadUserId === undefined) {
          updates.leadUserId = null;
        }
      }
      if (addMemberIds.length) {
        await transaction.insert(teamMemberships).values(addMemberIds.map((userId) => ({
          companyId: context.companyId,
          teamId: id,
          userId,
        }))).onConflictDoNothing();
        changes.addedMemberIds = addMemberIds;
      }
      if (leadUserId !== undefined && leadUserId !== current.leadUserId) {
        updates.leadUserId = leadUserId;
        changes.leadUserId = { from: current.leadUserId, to: leadUserId };
      }
      if (updates.leadUserId !== undefined) {
        await transaction.update(teamMemberships).set({ isLead: false })
          .where(and(eq(teamMemberships.teamId, id), eq(teamMemberships.companyId, context.companyId)));
        if (updates.leadUserId) {
          await transaction.insert(teamMemberships).values({
            companyId: context.companyId,
            teamId: id,
            userId: updates.leadUserId,
            isLead: true,
          }).onConflictDoUpdate({
            target: [teamMemberships.teamId, teamMemberships.userId],
            set: { isLead: true },
          });
        }
      }

      const [updated] = await transaction.update(teams).set(updates)
        .where(and(eq(teams.id, id), eq(teams.companyId, context.companyId)))
        .returning();
      await recordAudit(transaction, {
        companyId: context.companyId,
        actorId: context.session.user.id,
        action: changes.archived ? "team_archived" : "team_updated",
        entityType: "team",
        entityId: id,
        reason: `Team "${updated.name}" updated`,
        details: changes,
      });
      return updated;
    });
    return NextResponse.json({ team });
  } catch (error) {
    if (error instanceof TeamUpdateError) return errorResponse(error.message, error.status);
    throw error;
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/teams/[id]">) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can archive teams.", 403);
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Team not found.", 404);

  const archived = await getDb().transaction(async (transaction) => {
    const [team] = await transaction.update(teams).set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(teams.id, id), eq(teams.companyId, context.companyId)))
      .returning();
    if (!team) return null;
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "team_archived",
      entityType: "team",
      entityId: id,
      reason: `Team "${team.name}" archived`,
    });
    return team;
  });
  if (!archived) return errorResponse("Team not found.", 404);
  return NextResponse.json({ team: archived });
}
