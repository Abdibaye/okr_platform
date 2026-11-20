import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { buildPeriodComparisons } from "@/server/okr-math";
import { canEditKeyResult, canEditObjective, canManagePrivacy, canViewObjective, loadAccessIndex, viewerFromContext } from "@/server/org-access";
import {
  auditLogs,
  companyMemberships,
  keyResultEditors,
  keyResults,
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
  const accessIndex = await loadAccessIndex(database, context.companyId, allObjectives.map((objective) => objective.id));
  const visibleIds = new Set<string>();
  for (const objective of allObjectives) {
    if (canViewObjective(objective, viewer, accessIndex.factsFor(objective))) visibleIds.add(objective.id);
  }
  const objectiveRows = allObjectives.filter((objective) => visibleIds.has(objective.id) && !objective.archivedAt);
  const archivedObjectiveRows = allObjectives.filter((objective) => visibleIds.has(objective.id) && Boolean(objective.archivedAt));
  const objectiveIds = objectiveRows.map((objective) => objective.id);
  const archivedObjectiveIds = archivedObjectiveRows.map((objective) => objective.id);
  const archivedResultIds = archivedObjectiveIds.length
    ? await database.select({ id: keyResults.id })
      .from(keyResults)
      .where(and(
        eq(keyResults.companyId, context.companyId),
        inArray(keyResults.objectiveId, archivedObjectiveIds),
      ))
    : [];
  const resultRows = objectiveIds.length
    ? await database.select().from(keyResults).where(and(
      eq(keyResults.companyId, context.companyId),
      inArray(keyResults.objectiveId, objectiveIds),
      isNull(keyResults.archivedAt),
    )).orderBy(keyResults.createdAt)
    : [];
  const archivedKrs = archivedObjectiveIds.length
    ? await database.select({ objectiveId: keyResults.objectiveId }).from(keyResults).where(and(
      eq(keyResults.companyId, context.companyId),
      inArray(keyResults.objectiveId, archivedObjectiveIds),
    ))
    : [];
  const archivedKrCount = new Map<string, number>();
  for (const kr of archivedKrs) {
    archivedKrCount.set(kr.objectiveId, (archivedKrCount.get(kr.objectiveId) ?? 0) + 1);
  }
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
  const archivedResultRows = archivedResultIds.length
    ? await database.select().from(keyResults).where(inArray(keyResults.id, archivedResultIds.map((result) => result.id)))
      .orderBy(keyResults.createdAt)
    : [];
  const archivedEditorRows = archivedResultRows.length
    ? await database.select({ keyResultId: keyResultEditors.keyResultId, userId: keyResultEditors.userId }).from(keyResultEditors)
      .where(inArray(keyResultEditors.keyResultId, archivedResultRows.map((result) => result.id)))
    : [];
  const editorsByResult = new Map<string, string[]>();
  const addEditor = (row: { keyResultId: string; userId: string }) => {
    const list = editorsByResult.get(row.keyResultId) ?? [];
    list.push(row.userId);
    editorsByResult.set(row.keyResultId, list);
  };
  editorRows.forEach(addEditor);
  archivedEditorRows.forEach(addEditor);

  const person = (id: string | null) => {
    const member = id ? membersById.get(id) : undefined;
    return member ? { id: member.id, name: member.name, jobTitle: member.jobTitle } : null;
  };

  const hydratedObjectives = objectiveRows.map((objective) => {
    const facts = accessIndex.factsFor(objective);
    const parentVisible = objective.parentObjectiveId ? visibleIds.has(objective.parentObjectiveId) : false;
    const canEdit = canEditObjective(objective, viewer, facts);
    return {
      ...objective,
      parentObjectiveId: parentVisible ? objective.parentObjectiveId : null,
      parentRestricted: Boolean(objective.parentObjectiveId) && !parentVisible,
      owner: person(objective.ownerId),
      team: objective.teamId ? teamsById.get(objective.teamId) ?? null : null,
      access: accessIndex.accessFor(objective.id),
      canEdit,
      canManage: canManagePrivacy(objective, viewer, facts),
      canApprove: context.role === "admin" || (facts.ownerManagerId !== null && facts.ownerManagerId === userId),
      keyResults: resultRows.filter((result) => result.objectiveId === objective.id).map((result) => {
        const editors = editorsByResult.get(result.id) ?? [];
        return {
          ...result,
          owner: person(result.ownerId),
          editorIds: editors,
          canCheckIn: canEditKeyResult(objective, result, viewer, facts, editors),
        };
      }),
    };
  });
  const hydratedArchivedObjectives = archivedObjectiveRows.map((objective) => {
    const facts = accessIndex.factsFor(objective);
    const parentVisible = objective.parentObjectiveId ? visibleIds.has(objective.parentObjectiveId) : false;
    const canEdit = canEditObjective(objective, viewer, facts);
    return {
      ...objective,
      parentObjectiveId: parentVisible ? objective.parentObjectiveId : null,
      parentRestricted: Boolean(objective.parentObjectiveId) && !parentVisible,
      owner: person(objective.ownerId),
      team: objective.teamId ? teamsById.get(objective.teamId) ?? null : null,
      access: accessIndex.accessFor(objective.id),
      canEdit,
      canManage: canManagePrivacy(objective, viewer, facts),
      canApprove: context.role === "admin" || (facts.ownerManagerId !== null && facts.ownerManagerId === userId),
      keyResults: archivedResultRows.filter((result) => result.objectiveId === objective.id).map((result) => {
        const editors = editorsByResult.get(result.id) ?? [];
        return {
          ...result,
          owner: person(result.ownerId),
          editorIds: editors,
          canCheckIn: canEditKeyResult(objective, result, viewer, facts, editors),
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

  const archivedObjectives = archivedObjectiveRows.map((objective) => {
    const facts = accessIndex.factsFor(objective);
    return {
      id: objective.id,
      cycleId: objective.cycleId,
      title: objective.title,
      archivedAt: objective.archivedAt ? objective.archivedAt.toISOString() : null,
      canManage: canManagePrivacy(objective, viewer, facts),
      owner: person(objective.ownerId),
      keyResultCount: archivedKrCount.get(objective.id) ?? 0,
    };
  });
  const archivedObjectivesByCycle = new Map<string, typeof archivedObjectives>();
  for (const objective of archivedObjectives) {
    const list = archivedObjectivesByCycle.get(objective.cycleId) ?? [];
    list.push(objective);
    archivedObjectivesByCycle.set(objective.cycleId, list);
  }

  const hydratedCycles = cycles.map((cycle) => ({
    ...cycle,
    objectives: objectivesByCycle.get(cycle.id) ?? [],
    archivedObjectives: archivedObjectivesByCycle.get(cycle.id) ?? [],
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
  }).slice(0, 20)
    // Only what the feed renders; audit details can reference goals this viewer cannot see.
    .map((row) => ({ id: row.id, action: row.action, reason: row.reason, createdAt: row.createdAt }));

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
    workspaces: context.availableCompanies ?? [{ id: context.companyId, name: context.companyName, role: context.role }],
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
    archivedObjectives: hydratedArchivedObjectives,
    summaries,
    comparisons,
    audit,
  }, { headers: { "Cache-Control": "no-store" } });
}
