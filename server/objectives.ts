import { and, eq, inArray, isNull } from "drizzle-orm";
import { isUuid } from "./api-utils";
import { wouldCreateAlignmentLoop } from "./okr-math";
import type { Transaction } from "./people";
import type { RequestContext } from "./request-context";
import {
  companyMemberships,
  keyResultEditors,
  notifications,
  objectiveAccess,
  objectives,
  teamMemberships,
  teams,
} from "./schema";
import type { getDb } from "./db";

type Executor = ReturnType<typeof getDb> | Transaction;

export const GOAL_LEVELS = ["company", "team", "individual"] as const;
export const GOAL_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export const GOAL_VISIBILITIES = ["company", "team", "restricted"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalVisibility = (typeof GOAL_VISIBILITIES)[number];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ACCESS = 200;

export class InputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function oneOf<T extends string>(values: readonly T[], value: unknown, label: string): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new InputError(`Choose a valid ${label}.`);
  }
  return value as T;
}

function nullableId(value: unknown, label: string, uuid = true) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || (uuid && !isUuid(value)) || value.length > 200) throw new InputError(`Choose a valid ${label}.`);
  return value;
}

function idList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > MAX_ACCESS || !value.every((item) => typeof item === "string" && item && item.length <= 200)) {
    throw new InputError(`Provide a valid list of ${label}.`);
  }
  return [...new Set(value as string[])];
}

export interface ObjectiveInput {
  title?: string;
  description?: string;
  level?: GoalLevel;
  teamId?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
  status?: GoalStatus;
  visibility?: GoalVisibility;
  parentObjectiveId?: string | null;
  viewerIds?: string[];
  editorIds?: string[];
}

/** Parses the goal fields shared by create and update; only keys present in the body are returned. */
export function parseObjectiveInput(body: Record<string, unknown>): ObjectiveInput {
  const input: ObjectiveInput = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 240) throw new InputError("Goal title must be 1–240 characters.");
    input.title = title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.length > 10000) throw new InputError("Description must be 10,000 characters or fewer.");
    input.description = body.description.trim();
  }
  if (body.level !== undefined) input.level = oneOf(GOAL_LEVELS, body.level, "goal level");
  if (body.status !== undefined) input.status = oneOf(GOAL_STATUSES, body.status, "goal status");
  if (body.visibility !== undefined) input.visibility = oneOf(GOAL_VISIBILITIES, body.visibility, "privacy setting");
  if (body.teamId !== undefined) input.teamId = nullableId(body.teamId, "team");
  if (body.ownerId !== undefined) input.ownerId = nullableId(body.ownerId, "owner", false);
  if (body.parentObjectiveId !== undefined) input.parentObjectiveId = nullableId(body.parentObjectiveId, "parent goal");
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === "") input.dueDate = null;
    else if (isIsoDate(body.dueDate)) input.dueDate = body.dueDate;
    else throw new InputError("Due date must be a valid date (YYYY-MM-DD).");
  }
  if (body.viewerIds !== undefined) input.viewerIds = idList(body.viewerIds, "viewers");
  if (body.editorIds !== undefined) input.editorIds = idList(body.editorIds, "editors");
  if (input.viewerIds && input.editorIds) {
    // Editors already have view access; keep each person at their highest level.
    const editors = new Set(input.editorIds);
    input.viewerIds = input.viewerIds.filter((id) => !editors.has(id));
  }
  return input;
}

/** Throws unless every user id is an active member of the company. */
export async function assertActiveMembers(executor: Executor, companyId: string, userIds: string[], label: string) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const rows = await executor.select({ userId: companyMemberships.userId }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, companyId),
    eq(companyMemberships.isActive, true),
    inArray(companyMemberships.userId, unique),
  ));
  if (rows.length !== unique.length) throw new InputError(`${label} must be active members of this workspace.`);
}

export async function assertActiveTeam(executor: Executor, companyId: string, teamId: string) {
  const [team] = await executor.select({ id: teams.id }).from(teams).where(and(
    eq(teams.id, teamId),
    eq(teams.companyId, companyId),
    isNull(teams.archivedAt),
  )).limit(1);
  if (!team) throw new InputError("Choose an active team in this workspace.");
}

/**
 * Validates the parent link: same company, same cycle, not archived, and no alignment loop.
 * `objectiveId` is null when creating a new goal (a brand-new goal cannot close a loop).
 */
export async function assertValidParent(
  executor: Executor,
  companyId: string,
  cycleId: string,
  objectiveId: string | null,
  parentObjectiveId: string,
) {
  const rows = await executor.select({
    id: objectives.id,
    cycleId: objectives.cycleId,
    parentObjectiveId: objectives.parentObjectiveId,
    archivedAt: objectives.archivedAt,
  }).from(objectives).where(and(eq(objectives.companyId, companyId), eq(objectives.cycleId, cycleId)));
  const parent = rows.find((row) => row.id === parentObjectiveId);
  if (!parent || parent.archivedAt) throw new InputError("The aligned parent goal must be an active goal in the same cycle.");
  if (objectiveId) {
    const parentById = new Map(rows.map((row) => [row.id, row.parentObjectiveId]));
    if (wouldCreateAlignmentLoop(parentById, objectiveId, parentObjectiveId)) {
      throw new InputError("This alignment would create a loop: a goal cannot sit under itself or one of its own child goals.");
    }
  }
}

/** Checks team/level/visibility consistency once the final values are known. */
export function assertConsistentGoal(goal: { level: GoalLevel; teamId: string | null; visibility: GoalVisibility }) {
  if (goal.level === "team" && !goal.teamId) throw new InputError("Team goals need a team.");
  if (goal.visibility === "team" && !goal.teamId) throw new InputError("Choose a team before limiting privacy to that team.");
}

/** Replaces named viewers/editors. Only the lists that were provided are changed. */
export async function replaceObjectiveAccess(
  transaction: Transaction,
  companyId: string,
  objectiveId: string,
  viewerIds: string[] | undefined,
  editorIds: string[] | undefined,
) {
  if (viewerIds === undefined && editorIds === undefined) return;
  const existing = await transaction.select({ userId: objectiveAccess.userId, permission: objectiveAccess.permission })
    .from(objectiveAccess).where(eq(objectiveAccess.objectiveId, objectiveId));
  const viewers = viewerIds ?? existing.filter((row) => row.permission === "viewer").map((row) => row.userId);
  const editors = editorIds ?? existing.filter((row) => row.permission === "editor").map((row) => row.userId);
  const editorSet = new Set(editors);
  await transaction.delete(objectiveAccess).where(eq(objectiveAccess.objectiveId, objectiveId));
  const rows = [
    ...editors.map((userId) => ({ companyId, objectiveId, userId, permission: "editor" as const })),
    ...viewers.filter((userId) => !editorSet.has(userId)).map((userId) => ({ companyId, objectiveId, userId, permission: "viewer" as const })),
  ];
  if (rows.length) await transaction.insert(objectiveAccess).values(rows);
}

export async function replaceKeyResultEditors(transaction: Transaction, companyId: string, keyResultId: string, editorIds: string[]) {
  await transaction.delete(keyResultEditors).where(eq(keyResultEditors.keyResultId, keyResultId));
  if (editorIds.length) {
    await transaction.insert(keyResultEditors).values(editorIds.map((userId) => ({ companyId, keyResultId, userId })));
  }
}

export interface VisibilityFacts {
  visibility: GoalVisibility;
  teamId: string | null;
  ownerId: string | null;
  createdBy: string;
}

export interface ViewerFacts {
  userId: string;
  role: string;
  teamIds: string[];
}

/**
 * Privacy rules: company goals are visible to everyone; team goals to that team's members and managers;
 * restricted goals only to named people. Owner, owner's manager, named access, the creator and admins always see it.
 */
export function canViewObjective(
  objective: VisibilityFacts,
  viewer: ViewerFacts,
  ownerManagerId: string | null,
  accessUserIds: Set<string>,
) {
  if (objective.visibility === "company") return true;
  if (viewer.role === "admin") return true;
  if (objective.ownerId === viewer.userId || objective.createdBy === viewer.userId) return true;
  if (ownerManagerId && ownerManagerId === viewer.userId) return true;
  if (accessUserIds.has(viewer.userId)) return true;
  if (objective.visibility !== "team") return false;
  return viewer.role === "manager" || Boolean(objective.teamId && viewer.teamIds.includes(objective.teamId));
}

/** Admins, managers, the owner and named editors may change a goal's content. */
export function canEditObjective(objective: { ownerId: string | null }, viewer: ViewerFacts, editorIds: Set<string>) {
  return viewer.role === "admin" || viewer.role === "manager" || objective.ownerId === viewer.userId || editorIds.has(viewer.userId);
}

/** Only admins, managers and the owner may change ownership or privacy. */
export function canManagePrivacy(objective: { ownerId: string | null }, viewer: ViewerFacts) {
  return viewer.role === "admin" || viewer.role === "manager" || objective.ownerId === viewer.userId;
}

export function viewerFromContext(context: RequestContext): ViewerFacts {
  return { userId: context.session.user.id, role: context.role, teamIds: context.teamIds };
}

/** Loads the access facts needed to evaluate view/edit permissions for one goal. */
export async function loadObjectiveAccessFacts(executor: Executor, companyId: string, objectiveId: string, ownerId: string | null) {
  const access = await executor.select({ userId: objectiveAccess.userId, permission: objectiveAccess.permission })
    .from(objectiveAccess).where(and(eq(objectiveAccess.companyId, companyId), eq(objectiveAccess.objectiveId, objectiveId)));
  let ownerManagerId: string | null = null;
  if (ownerId) {
    const [owner] = await executor.select({ managerId: companyMemberships.managerId }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.userId, ownerId),
    )).limit(1);
    ownerManagerId = owner?.managerId ?? null;
  }
  return {
    accessUserIds: new Set(access.map((row) => row.userId)),
    editorIds: new Set(access.filter((row) => row.permission === "editor").map((row) => row.userId)),
    ownerManagerId,
  };
}

export async function teamMemberIds(executor: Executor, companyId: string, teamId: string) {
  const rows = await executor.select({ userId: teamMemberships.userId }).from(teamMemberships).where(and(
    eq(teamMemberships.companyId, companyId),
    eq(teamMemberships.teamId, teamId),
  ));
  return rows.map((row) => row.userId);
}

export async function notify(executor: Executor, entry: {
  companyId: string;
  recipientId: string;
  actorId: string;
  title: string;
  body: string;
  objectiveId: string;
  dedupKey: string;
}) {
  await executor.insert(notifications).values({
    companyId: entry.companyId,
    recipientId: entry.recipientId,
    actorId: entry.actorId,
    type: "approval",
    title: entry.title.slice(0, 240),
    body: entry.body,
    linkPath: `/dashboard/goals?goal=${entry.objectiveId}`,
    entityType: "objective",
    entityId: entry.objectiveId,
    dedupKey: entry.dedupKey.slice(0, 240),
  }).onConflictDoNothing();
}

export const METRIC_TYPES = ["numeric", "percentage", "currency", "binary"] as const;
export const DIRECTIONS = ["increasing", "decreasing"] as const;

export interface KeyResultInput {
  title?: string;
  metricType?: (typeof METRIC_TYPES)[number];
  direction?: (typeof DIRECTIONS)[number];
  unit?: string;
  baseline?: number;
  target?: number;
  current?: number;
  ownerId?: string | null;
  dueDate?: string | null;
  editorIds?: string[];
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 1e10) throw new InputError(`Provide a valid ${label}.`);
  return value;
}

/** Parses key result fields; only keys present in the body are returned. */
export function parseKeyResultInput(body: Record<string, unknown>): KeyResultInput {
  const input: KeyResultInput = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 240) throw new InputError("Key result title must be 1–240 characters.");
    input.title = title;
  }
  if (body.metricType !== undefined) input.metricType = oneOf(METRIC_TYPES, body.metricType, "metric type");
  if (body.direction !== undefined) input.direction = oneOf(DIRECTIONS, body.direction, "metric direction");
  if (body.unit !== undefined) {
    if (typeof body.unit !== "string" || body.unit.trim().length > 24) throw new InputError("Unit must be 24 characters or fewer.");
    input.unit = body.unit.trim();
  }
  if (body.baseline !== undefined) input.baseline = finiteNumber(body.baseline, "baseline");
  if (body.target !== undefined) input.target = finiteNumber(body.target, "target");
  if (body.current !== undefined) input.current = finiteNumber(body.current, "current value");
  if (body.ownerId !== undefined) input.ownerId = nullableId(body.ownerId, "key result owner", false);
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === "") input.dueDate = null;
    else if (isIsoDate(body.dueDate)) input.dueDate = body.dueDate;
    else throw new InputError("Due date must be a valid date (YYYY-MM-DD).");
  }
  if (body.editorIds !== undefined) input.editorIds = idList(body.editorIds, "key result editors");
  return input;
}
