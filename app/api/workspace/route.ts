import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { buildPeriodComparisons } from "@/server/okr-math";
import { canEditObjective, canManagePrivacy, canViewObjective, viewerFromContext } from "@/server/objectives";
import {
  auditLogs,
  companyMemberships,
  keyResultEditors,
  keyResults,
  objectiveAccess,
  objectives,
  okrCycles,
  teamMemberships,
  teams,
  user,
} from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;

  const database = getDb();
  const viewer = viewerFromContext(context);
  const userId = context.session.user.id;

  const [cycles, memberRows, teamRows, teamMemberRows] = await Promise.all([
    database.select().from(okrCycles)
      .where(eq(okrCycles.companyId, context.companyId))
      .orderBy(desc(okrCycles.startDate)),
    database.select({
      id: companyMemberships.userId,
      name: user.name,
      email: user.email,
      role: companyMemberships.role,
      jobTitle: companyMemberships.jobTitle,
      managerId: companyMemberships.managerId,
      isActive: companyMemberships.isActive,
    }).from(companyMemberships)
      .innerJoin(user, eq(user.id, companyMemberships.userId))
      .where(eq(companyMemberships.companyId, context.companyId))
      .orderBy(user.name),
    database.select({ id: teams.id, name: teams.name }).from(teams)
      .where(and(eq(teams.companyId, context.companyId), isNull(teams.archivedAt)))
      .orderBy(teams.name),
    database.select({ teamId: teamMemberships.teamId, userId: teamMemberships.userId }).from(teamMemberships)
      .where(eq(teamMemberships.companyId, context.companyId)),
  ]);
  const membersById = new Map(memberRows.map((member) => [member.id, member]));
  const teamsById = new Map(teamRows.map((team) => [team.id, team]));

  const cycleIds = cycles.map((cycle) => cycle.id);
  const allObjectives = cycleIds.length
    ? await database.select().from(objectives).where(and(
      eq(objectives.companyId, context.companyId),
      inArray(objectives.cycleId, cycleIds),
    )).orderBy(desc(objectives.createdAt))
    : [];
  const accessRows = allObjectives.length
    ? await database.select({ objectiveId: objectiveAccess.objectiveId, userId: objectiveAccess.userId, permission: objectiveAccess.permission })
      .from(objectiveAccess)
      .where(eq(objectiveAccess.companyId, context.companyId))
    : [];
  const accessByObjective = new Map<string, { userId: string; permission: "viewer" | "editor" }[]>();
  for (const row of accessRows) {
    const list = accessByObjective.get(row.objectiveId) ?? [];
    list.push({ userId: row.userId, permission: row.permission });
    accessByObjective.set(row.objectiveId, list);
  }

  const visibleIds = new Set<string>();
  for (const objective of allObjectives) {
    const access = accessByObjective.get(objective.id) ?? [];
    const ownerManagerId = objective.ownerId ? membersById.get(objective.ownerId)?.managerId ?? null : null;
    if (canViewObjective(objective, viewer, ownerManagerId, new Set(access.map((row) => row.userId)))) visibleIds.add(objective.id);
  }
  const objectiveRows = allObjectives.filter((objective) => visibleIds.has(objective.id) && !objective.archivedAt);
  const objectiveIds = objectiveRows.map((objective) => objective.id);
  const resultRows = objectiveIds.length
    ? await database.select().from(keyResults).where(and(
      eq(keyResults.companyId, context.companyId),
      inArray(keyResults.objectiveId, objectiveIds),
      isNull(keyResults.archivedAt),
    )).orderBy(keyResults.createdAt)
    : [];
  const editorRows = resultRows.length
    ? await database.select({ keyResultId: keyResultEditors.keyResultId, userId: keyResultEditors.userId }).from(keyResultEditors)
      .where(inArray(keyResultEditors.keyResultId, resultRows.map((result) => result.id)))
    : [];
  const auditRows = cycleIds.length
    ? await database.select().from(auditLogs).where(and(
      eq(auditLogs.companyId, context.companyId),
      inArray(auditLogs.cycleId, cycleIds),
    )).orderBy(desc(auditLogs.createdAt)).limit(60)
    : [];

  const krObjective = new Map(resultRows.map((result) => [result.id, result.objectiveId]));
  const editorsByResult = new Map<string, string[]>();
  for (const row of editorRows) {
    const list = editorsByResult.get(row.keyResultId) ?? [];
    list.push(row.userId);
    editorsByResult.set(row.keyResultId, list);
  }

  const person = (id: string | null) => {
    const member = id ? membersById.get(id) : undefined;
    return member ? { id: member.id, name: member.name, jobTitle: member.jobTitle } : null;
  };

  const hydratedObjectives = objectiveRows.map((objective) => {
    const access = accessByObjective.get(objective.id) ?? [];
    const editorIds = new Set(access.filter((row) => row.permission === "editor").map((row) => row.userId));
    const ownerManagerId = objective.ownerId ? membersById.get(objective.ownerId)?.managerId ?? null : null;
    const canEdit = canEditObjective(objective, viewer, editorIds);
    const unowned = !objective.ownerId;
    return {
      ...objective,
      owner: person(objective.ownerId),
      team: objective.teamId ? teamsById.get(objective.teamId) ?? null : null,
      access,
      canEdit,
      canManage: canManagePrivacy(objective, viewer),
      canApprove: context.role === "admin" || (ownerManagerId !== null && ownerManagerId === userId),
      keyResults: resultRows.filter((result) => result.objectiveId === objective.id).map((result) => {
        const editors = editorsByResult.get(result.id) ?? [];
        return {
          ...result,
          owner: person(result.ownerId),
          editorIds: editors,
          canCheckIn: canEdit || result.ownerId === userId || editors.includes(userId) || (unowned && !result.ownerId),
        };
      }),
    };
  });

  const objectivesByCycle = new Map<string, typeof hydratedObjectives>();
  for (const objective of hydratedObjectives) {
    const list = objectivesByCycle.get(objective.cycleId) ?? [];
    list.push(objective);
    objectivesByCycle.set(objective.cycleId, list);
  }
  const hydratedCycles = cycles.map((cycle) => ({
    ...cycle,
    objectives: objectivesByCycle.get(cycle.id) ?? [],
  }));
  const { summaries, comparisons } = buildPeriodComparisons(hydratedCycles);

  // Hide activity about goals the viewer cannot see.
  const audit = auditRows.filter((row) => {
    if (row.entityType === "objective" && row.entityId) return visibleIds.has(row.entityId) || context.role === "admin";
    if (row.entityType === "key_result" && row.entityId) {
      const objectiveId = krObjective.get(row.entityId);
      return context.role === "admin" || (objectiveId !== undefined && visibleIds.has(objectiveId));
    }
    return true;
  }).slice(0, 20);

  return NextResponse.json({
    user: {
      id: userId,
      name: context.session.user.name,
      email: context.session.user.email,
      jobTitle: context.jobTitle,
      managerId: context.managerId,
      teamIds: context.teamIds,
      directReportIds: memberRows.filter((member) => member.managerId === userId && member.isActive).map((member) => member.id),
    },
    company: { id: context.companyId, name: context.companyName, role: context.role },
    members: memberRows.map((member) => ({
      id: member.id,
      name: member.name,
      email: context.role !== "member" || member.id === userId ? member.email : "",
      jobTitle: member.jobTitle,
      managerId: member.managerId,
      isActive: member.isActive,
      teamIds: teamMemberRows.filter((row) => row.userId === member.id).map((row) => row.teamId),
    })),
    teams: teamRows,
    cycles: hydratedCycles,
    summaries,
    comparisons,
    audit,
  }, { headers: { "Cache-Control": "no-store" } });
}
