import { and, eq, inArray, isNull } from "drizzle-orm";
import type { getDb } from "./db";
import type { Transaction } from "./people";
import type { RequestContext } from "./request-context";
import { companyMemberships, keyResultEditors, keyResults, objectiveAccess, objectives, teamMemberships } from "./schema";

/**
 * Single source of truth for who may see and change goals. Every API that returns goal data
 * (workspace, reports, exports, comments, notifications, direct-ID routes) evaluates these rules.
 */

type Executor = ReturnType<typeof getDb> | Transaction;

export interface VisibilityFacts {
  visibility: "company" | "team" | "restricted";
  teamId: string | null;
  ownerId: string | null;
  createdBy: string;
}

export interface ViewerFacts {
  userId: string;
  role: string;
  teamIds: string[];
}

export interface OrgMember {
  userId: string;
  role: string;
  managerId: string | null;
  isActive: boolean;
  teamIds: string[];
}

/** Every membership in one company, keyed by user id. */
export type OrgChart = Map<string, OrgMember>;

export interface ObjectiveAccessFacts {
  /** Named viewers and editors of the goal. */
  accessUserIds: Set<string>;
  editorIds: Set<string>;
  /** Owners and named editors of the goal's active key results. */
  keyResultAssigneeIds: Set<string>;
  ownerManagerId: string | null;
  chart: OrgChart;
}

export function viewerFromContext(context: RequestContext): ViewerFacts {
  return { userId: context.session.user.id, role: context.role, teamIds: context.teamIds };
}

/** Viewer facts for another active member, or null when they are not an active member. */
export function viewerFromChart(chart: OrgChart, userId: string): ViewerFacts | null {
  const member = chart.get(userId);
  return member?.isActive ? { userId, role: member.role, teamIds: member.teamIds } : null;
}

/** True when `managerId` sits anywhere above `userId` in the reporting chain. */
export function managesInChain(chart: OrgChart, managerId: string, userId: string) {
  const seen = new Set<string>();
  let current = chart.get(userId)?.managerId ?? null;
  while (current && !seen.has(current)) {
    if (current === managerId) return true;
    seen.add(current);
    current = chart.get(current)?.managerId ?? null;
  }
  return false;
}

/**
 * company: every active member. team: members of the goal's team. restricted: named people only.
 * Admins, the owner, the creator, the owner's manager, named viewers/editors and the people assigned
 * to one of its key results can always see it.
 */
export function canViewObjective(objective: VisibilityFacts, viewer: ViewerFacts, facts: ObjectiveAccessFacts) {
  if (objective.visibility === "company") return true;
  if (viewer.role === "admin") return true;
  if (objective.ownerId === viewer.userId || objective.createdBy === viewer.userId) return true;
  if (facts.ownerManagerId && facts.ownerManagerId === viewer.userId) return true;
  if (facts.accessUserIds.has(viewer.userId) || facts.keyResultAssigneeIds.has(viewer.userId)) return true;
  return objective.visibility === "team" && Boolean(objective.teamId && viewer.teamIds.includes(objective.teamId));
}

/** Admins, the owner, managers in the owner's reporting chain and named editors may change a goal. */
export function canEditObjective(objective: VisibilityFacts, viewer: ViewerFacts, facts: ObjectiveAccessFacts) {
  if (!canViewObjective(objective, viewer, facts)) return false;
  if (viewer.role === "admin" || objective.ownerId === viewer.userId || facts.editorIds.has(viewer.userId)) return true;
  // Unowned goals fall back to their creator.
  if (!objective.ownerId) return objective.createdBy === viewer.userId;
  return managesInChain(facts.chart, viewer.userId, objective.ownerId);
}

/** Only admins, the owner and managers in the owner's reporting chain may change ownership or privacy. */
export function canManagePrivacy(objective: VisibilityFacts, viewer: ViewerFacts, facts: ObjectiveAccessFacts) {
  if (!canViewObjective(objective, viewer, facts)) return false;
  if (viewer.role === "admin" || objective.ownerId === viewer.userId) return true;
  if (!objective.ownerId) return objective.createdBy === viewer.userId;
  return managesInChain(facts.chart, viewer.userId, objective.ownerId);
}

/**
 * Goal editors, plus the key result's owner, managers in that owner's reporting chain and its named
 * editors. Legacy key results with no owner on an unowned goal stay open to anyone who can see the goal.
 */
export function canEditKeyResult(
  objective: VisibilityFacts,
  keyResult: { ownerId: string | null },
  viewer: ViewerFacts,
  facts: ObjectiveAccessFacts,
  keyResultEditorIds: Iterable<string>,
) {
  if (!canViewObjective(objective, viewer, facts)) return false;
  if (canEditObjective(objective, viewer, facts)) return true;
  if (!objective.ownerId && !keyResult.ownerId) return true;
  if (keyResult.ownerId === viewer.userId || new Set(keyResultEditorIds).has(viewer.userId)) return true;
  return Boolean(keyResult.ownerId && managesInChain(facts.chart, viewer.userId, keyResult.ownerId));
}

/** Whether the viewer may ask `userId` for a check-in: admins always, otherwise managers in their reporting chain. */
export function canRequestCheckIn(viewer: ViewerFacts, chart: OrgChart, userId: string) {
  return viewer.role === "admin" || managesInChain(chart, viewer.userId, userId);
}

export async function loadOrgChart(executor: Executor, companyId: string): Promise<OrgChart> {
  // Sequential on purpose: these may run inside a transaction, which shares one connection.
  const memberRows = await executor.select({
    userId: companyMemberships.userId,
    role: companyMemberships.role,
    managerId: companyMemberships.managerId,
    isActive: companyMemberships.isActive,
  }).from(companyMemberships).where(eq(companyMemberships.companyId, companyId));
  const teamRows = await executor.select({ userId: teamMemberships.userId, teamId: teamMemberships.teamId }).from(teamMemberships)
    .where(eq(teamMemberships.companyId, companyId));
  const chart: OrgChart = new Map(memberRows.map((row) => [row.userId, { ...row, teamIds: [] as string[] }]));
  for (const row of teamRows) chart.get(row.userId)?.teamIds.push(row.teamId);
  return chart;
}

/**
 * Loads the access facts for many goals at once. `factsFor` returns the facts of one goal; goals
 * outside `objectiveIds` get empty access lists.
 */
export async function loadAccessIndex(executor: Executor, companyId: string, objectiveIds: string[], chart?: OrgChart) {
  const ids = [...new Set(objectiveIds)];
  const orgChart = chart ?? await loadOrgChart(executor, companyId);
  const accessRows = ids.length
    ? await executor.select({ objectiveId: objectiveAccess.objectiveId, userId: objectiveAccess.userId, permission: objectiveAccess.permission })
        .from(objectiveAccess)
        .where(and(eq(objectiveAccess.companyId, companyId), inArray(objectiveAccess.objectiveId, ids)))
    : [];
  const resultRows = ids.length
    ? await executor.select({ objectiveId: keyResults.objectiveId, ownerId: keyResults.ownerId }).from(keyResults)
        .where(and(eq(keyResults.companyId, companyId), inArray(keyResults.objectiveId, ids), isNull(keyResults.archivedAt)))
    : [];
  const editorRows = ids.length
    ? await executor.select({ objectiveId: keyResults.objectiveId, userId: keyResultEditors.userId }).from(keyResultEditors)
        .innerJoin(keyResults, eq(keyResults.id, keyResultEditors.keyResultId))
        .where(and(eq(keyResults.companyId, companyId), inArray(keyResults.objectiveId, ids), isNull(keyResults.archivedAt)))
    : [];

  const access = new Map<string, { userId: string; permission: "viewer" | "editor" }[]>();
  for (const row of accessRows) {
    const list = access.get(row.objectiveId) ?? [];
    list.push({ userId: row.userId, permission: row.permission });
    access.set(row.objectiveId, list);
  }
  const assignees = new Map<string, Set<string>>();
  const assign = (objectiveId: string, userId: string | null) => {
    if (!userId) return;
    const set = assignees.get(objectiveId) ?? new Set<string>();
    set.add(userId);
    assignees.set(objectiveId, set);
  };
  for (const row of resultRows) assign(row.objectiveId, row.ownerId);
  for (const row of editorRows) assign(row.objectiveId, row.userId);

  return {
    chart: orgChart,
    /** Named viewers/editors of a goal, as shown in the privacy panel. */
    accessFor: (objectiveId: string) => access.get(objectiveId) ?? [],
    factsFor: (objective: { id: string; ownerId: string | null }): ObjectiveAccessFacts => {
      const list = access.get(objective.id) ?? [];
      return {
        accessUserIds: new Set(list.map((row) => row.userId)),
        editorIds: new Set(list.filter((row) => row.permission === "editor").map((row) => row.userId)),
        keyResultAssigneeIds: assignees.get(objective.id) ?? new Set(),
        ownerManagerId: objective.ownerId ? orgChart.get(objective.ownerId)?.managerId ?? null : null,
        chart: orgChart,
      };
    },
  };
}

export type AccessIndex = Awaited<ReturnType<typeof loadAccessIndex>>;

/** Loads the access facts needed to evaluate view/edit permissions for one goal. */
export async function loadObjectiveAccessFacts(executor: Executor, companyId: string, objectiveId: string, ownerId: string | null) {
  const index = await loadAccessIndex(executor, companyId, [objectiveId]);
  return index.factsFor({ id: objectiveId, ownerId });
}

/** A non-archived goal in the viewer's company that they may see, or null (callers answer 404). */
export async function loadVisibleObjective(executor: Executor, context: RequestContext, objectiveId: string) {
  const [objective] = await executor.select().from(objectives).where(and(
    eq(objectives.id, objectiveId),
    eq(objectives.companyId, context.companyId),
    isNull(objectives.archivedAt),
  )).limit(1);
  if (!objective) return null;
  const facts = await loadObjectiveAccessFacts(executor, context.companyId, objective.id, objective.ownerId);
  return canViewObjective(objective, viewerFromContext(context), facts) ? { objective, facts } : null;
}
