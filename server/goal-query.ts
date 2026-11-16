import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { canViewObjective, loadAccessIndex, viewerFromContext, type AccessIndex, type ViewerFacts } from "./org-access";
import type { RequestContext } from "./request-context";
import { companyMemberships, keyResults, objectives, okrCycles, teamMemberships, teams, user } from "./schema";

export type ReportView = "my" | "team" | "company";
export type GoalStatusFilter = "draft" | "active" | "completed" | "cancelled";
export type ConfidenceFilter = "on_track" | "at_risk" | "off_track";

export interface GoalQueryFilters {
  view?: ReportView;
  cycleId?: string;
  teamId?: string;
  ownerId?: string;
  confidence?: ConfidenceFilter;
  status?: GoalStatusFilter;
  q?: string;
  overdueOnly?: boolean;
  staleOnly?: boolean;
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
}

export interface FilteredGoal {
  id: string;
  cycleId: string;
  title: string;
  description: string;
  progress: string | null;
  level: "company" | "team" | "individual";
  teamId: string | null;
  teamName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  dueDate: string | null;
  status: GoalStatusFilter;
  visibility: "company" | "team" | "restricted";
  parentObjectiveId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  keyResults: Array<{
    id: string;
    objectiveId: string;
    title: string;
    metricType: "numeric" | "percentage" | "currency" | "binary";
    direction: "increasing" | "decreasing";
    unit: string;
    baseline: string;
    target: string;
    current: string;
    progress: string;
    ownerId: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    dueDate: string | null;
    confidence: ConfidenceFilter;
    lastCheckInAt: Date | null;
    lastEffectiveDate: string | null;
    archivedAt: Date | null;
    updatedAt: Date;
  }>;
}

export interface FilteredGoalPage {
  goals: FilteredGoal[];
  cycles: Array<{ id: string; name: string; startDate: string; endDate: string; status: "draft" | "open" | "closed"; finalReflection: string; archivedAt: Date | null }>;
  company: { id: string; name: string };
  teamsById: Map<string, { id: string; name: string }>;
  membersById: Map<string, { id: string; name: string; email: string }>;
  accessIndex: AccessIndex;
  viewer: ViewerFacts;
  page: number;
  pageSize: number;
  totalGoals: number;
  totalPages: number;
  hasNextPage: boolean;
}

const MAX_PAGE_SIZE = 200;
const STALE_DAYS = 14;

export function parseGoalQueryFilters(searchParams: URLSearchParams): GoalQueryFilters {
  const optionalUuid = (key: string) => {
    const value = searchParams.get(key);
    return value ? value : undefined;
  };
  const view = searchParams.get("view");
  const confidence = searchParams.get("confidence");
  const status = searchParams.get("status");
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "50");
  return {
    view: view === "my" || view === "team" || view === "company" ? view : undefined,
    cycleId: optionalUuid("cycleId"),
    teamId: optionalUuid("teamId"),
    ownerId: optionalUuid("ownerId"),
    confidence: confidence === "on_track" || confidence === "at_risk" || confidence === "off_track" ? confidence : undefined,
    status: status === "draft" || status === "active" || status === "completed" || status === "cancelled" ? status : undefined,
    q: searchParams.get("q")?.trim() || undefined,
    overdueOnly: searchParams.get("overdueOnly") === "true",
    staleOnly: searchParams.get("staleOnly") === "true",
    includeArchived: searchParams.get("includeArchived") === "true",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize >= 1 ? Math.min(pageSize, MAX_PAGE_SIZE) : 50,
  };
}

function staleCutoff() {
  return new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
}

/** Server-side filter shared by workspace, reports and CSV exports. Visibility is always evaluated first. */
export async function loadFilteredGoals(context: RequestContext, filters: GoalQueryFilters): Promise<FilteredGoalPage> {
  const database = getDb();
  const viewer = viewerFromContext(context);
  const cycles = await database.select().from(okrCycles)
    .where(eq(okrCycles.companyId, context.companyId))
    .orderBy(desc(okrCycles.startDate));
  const selectedCycles = filters.cycleId ? cycles.filter((cycle) => cycle.id === filters.cycleId) : cycles;

  const [memberRows, teamRows] = await Promise.all([
    database.select({
      id: user.id,
      name: user.name,
      email: user.email,
    }).from(companyMemberships)
      .innerJoin(user, eq(user.id, companyMemberships.userId))
      .where(eq(companyMemberships.companyId, context.companyId)),
    database.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.companyId, context.companyId)),
  ]);

  const objectiveRows = selectedCycles.length ? await database.select().from(objectives)
    .where(and(
      eq(objectives.companyId, context.companyId),
      inArray(objectives.cycleId, selectedCycles.map((cycle) => cycle.id)),
      filters.includeArchived ? undefined : isNull(objectives.archivedAt),
    ))
    .orderBy(desc(objectives.createdAt)) : [];
  const accessIndex = await loadAccessIndex(database, context.companyId, objectiveRows.map((objective) => objective.id));
  const visibleObjectives = objectiveRows.filter((objective) =>
    canViewObjective(objective, viewer, accessIndex.factsFor(objective)));

  const search = filters.q?.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const teamMemberRows = filters.view === "team" ? await database.select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.companyId, context.companyId), eq(teamMemberships.userId, viewer.userId))) : [];
  const viewerTeamIds = new Set(teamMemberRows.map((row) => row.teamId));
  const cutoff = staleCutoff();

  const filteredIds = new Set<string>();
  const resultRows = visibleObjectives.length ? await database.select().from(keyResults)
    .where(and(
      eq(keyResults.companyId, context.companyId),
      inArray(keyResults.objectiveId, visibleObjectives.map((objective) => objective.id)),
      filters.includeArchived ? undefined : isNull(keyResults.archivedAt),
    ))
    .orderBy(asc(keyResults.createdAt)) : [];
  const resultsByObjective = new Map<string, typeof resultRows>();
  for (const result of resultRows) {
    const list = resultsByObjective.get(result.objectiveId) ?? [];
    list.push(result);
    resultsByObjective.set(result.objectiveId, list);
  }

  const membersById = new Map(memberRows.map((member) => [member.id, member]));
  const teamsById = new Map(teamRows.map((team) => [team.id, team]));
  const filtered = visibleObjectives.filter((objective) => {
    if (filters.cycleId && objective.cycleId !== filters.cycleId) return false;
    if (filters.teamId && objective.teamId !== filters.teamId) return false;
    if (filters.ownerId && objective.ownerId !== filters.ownerId) return false;
    if (filters.status && objective.status !== filters.status) return false;
    if (filters.view === "my" && objective.ownerId !== viewer.userId) return false;
    if (filters.view === "team") {
      if (!objective.teamId || !viewerTeamIds.has(objective.teamId)) return false;
    }
    if (search && !(`${objective.title}\n${objective.description}`.toLowerCase().includes(search))) return false;
    if (filters.overdueOnly && !(objective.dueDate && objective.dueDate < today && objective.status !== "completed" && objective.status !== "cancelled" && Number(objective.progress ?? 0) < 100)) return false;
    if (filters.staleOnly) {
      const results = resultsByObjective.get(objective.id) ?? [];
      if (!results.length || !results.some((result) => result.lastCheckInAt && result.lastCheckInAt >= cutoff)) return false;
    }
    if (filters.confidence) {
      const results = resultsByObjective.get(objective.id) ?? [];
      if (!results.some((result) => result.confidence === filters.confidence)) return false;
    }
    filteredIds.add(objective.id);
    return true;
  });

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const goals = paged.map((objective) => {
    const owner = objective.ownerId ? membersById.get(objective.ownerId) : undefined;
    return {
      ...objective,
      teamName: objective.teamId ? teamsById.get(objective.teamId)?.name ?? null : null,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
      keyResults: (resultsByObjective.get(objective.id) ?? []).map((result) => ({
        ...result,
        ownerName: result.ownerId ? membersById.get(result.ownerId)?.name ?? null : null,
        ownerEmail: result.ownerId ? membersById.get(result.ownerId)?.email ?? null : null,
      })),
    };
  });

  return {
    goals,
    cycles: selectedCycles.map((cycle) => ({
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      status: cycle.status,
      finalReflection: cycle.finalReflection,
      archivedAt: cycle.archivedAt,
    })),
    company: { id: context.companyId, name: context.companyName },
    teamsById,
    membersById,
    accessIndex,
    viewer,
    page,
    pageSize,
    totalGoals: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    hasNextPage: page * pageSize < filtered.length,
  };
}
