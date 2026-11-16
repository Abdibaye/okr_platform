import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { buildPeriodComparisons, type CycleMetricInput } from "./okr-math";
import { loadFilteredGoals, type FilteredGoalPage, type GoalQueryFilters } from "./goal-query";
import type { RequestContext } from "./request-context";
import { krCheckIns } from "./schema";

const round = (value: number) => Math.round(value * 100) / 100;

function group(
  goals: FilteredGoalPage["goals"],
  key: (goal: FilteredGoalPage["goals"][number]) => string,
  label: (id: string, goal: FilteredGoalPage["goals"][number]) => string,
) {
  const groups = new Map<string, { name: string; goalCount: number; keyResultCount: number; progressTotal: number; scoredCount: number }>();
  for (const goal of goals) {
    const id = key(goal);
    const group = groups.get(id) ?? { name: label(id, goal), goalCount: 0, keyResultCount: 0, progressTotal: 0, scoredCount: 0 };
    group.goalCount += 1;
    group.keyResultCount += goal.keyResults.length;
    if (goal.progress !== null) {
      group.progressTotal += Number(goal.progress);
      group.scoredCount += 1;
    }
    groups.set(id, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    name: group.name,
    goalCount: group.goalCount,
    keyResultCount: group.keyResultCount,
    averageProgress: group.scoredCount ? round(group.progressTotal / group.scoredCount) : null,
  }));
}

function weekStart(value: Date | string) {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export async function buildReport(context: RequestContext, filters: GoalQueryFilters) {
  const data = await loadFilteredGoals(context, filters);
  const goals = data.goals;
  const keyResults = goals.flatMap((goal) => goal.keyResults);
  const confidence = { on_track: 0, at_risk: 0, off_track: 0 } as Record<string, number>;
  for (const result of keyResults) confidence[result.confidence] = (confidence[result.confidence] ?? 0) + 1;

  const today = new Date().toISOString().slice(0, 10);
  const overdueGoals = goals.filter((goal) =>
    goal.dueDate && goal.dueDate < today && goal.status !== "completed" && goal.status !== "cancelled" && Number(goal.progress ?? 0) < 100)
    .map((goal) => ({ id: goal.id, title: goal.title, dueDate: goal.dueDate, ownerName: goal.ownerName, progress: Number(goal.progress ?? 0) }));

  const staleCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const staleKeyResults = keyResults.filter((result) => !result.lastCheckInAt || result.lastCheckInAt.getTime() < staleCutoff)
    .map((result) => {
      const goal = goals.find((candidate) => candidate.id === result.objectiveId);
      return {
        id: result.id,
        title: result.title,
        objectiveTitle: goal?.title ?? "",
        ownerName: result.ownerName,
        lastCheckInAt: result.lastCheckInAt,
        lastEffectiveDate: result.lastEffectiveDate,
      };
    });

  const database = getDb();
  const checkInRows = goals.length ? await database.select({
    id: krCheckIns.id,
    objectiveId: krCheckIns.objectiveId,
    effectiveDate: krCheckIns.effectiveDate,
    progress: krCheckIns.progress,
    createdAt: krCheckIns.createdAt,
  }).from(krCheckIns)
    .where(and(eq(krCheckIns.companyId, context.companyId)))
    .orderBy(desc(krCheckIns.createdAt)) : [];
  const visibleGoalIds = new Set(goals.map((goal) => goal.id));
  const visibleCheckIns = checkInRows.filter((row) => visibleGoalIds.has(row.objectiveId));
  const trend = new Map<string, { weekOf: string; checkInCount: number; averageProgress: number }>();
  for (const checkIn of visibleCheckIns) {
    const week = weekStart(checkIn.effectiveDate);
    const bucket = trend.get(week) ?? { weekOf: week, checkInCount: 0, averageProgress: 0 };
    bucket.checkInCount += 1;
    bucket.averageProgress = round((bucket.averageProgress * (bucket.checkInCount - 1) + Number(checkIn.progress)) / bucket.checkInCount);
    trend.set(week, bucket);
  }

  const cycleInputs: CycleMetricInput[] = data.cycles.map((cycle) => ({
    ...cycle,
    objectives: goals.filter((goal) => goal.cycleId === cycle.id).map((goal) => ({
      progress: goal.progress,
      keyResults: goal.keyResults.map((keyResult) => ({ id: keyResult.id })),
    })),
  }));
  const { summaries: cycleHistory, comparisons } = buildPeriodComparisons(cycleInputs);

  return {
    cycle: data.cycles[0] ?? null,
    pagination: { page: data.page, pageSize: data.pageSize, totalGoals: data.totalGoals, totalPages: data.totalPages, hasNextPage: data.hasNextPage },
    rollups: {
      company: [{ id: data.company.id, name: data.company.name, goalCount: goals.length, keyResultCount: keyResults.length,
        averageProgress: goals.length ? round(goals.reduce((total, goal) => total + Number(goal.progress ?? 0), 0) / goals.length) : null }],
      team: group(goals, (goal) => goal.teamId ?? "unassigned", (id) => id === "unassigned" ? "No team" : data.teamsById.get(id)?.name ?? id),
      owner: group(goals, (goal) => goal.ownerId ?? "unassigned", (id) => id === "unassigned" ? "No owner" : data.membersById.get(id)?.name ?? id),
      cycle: group(goals, (goal) => goal.cycleId, (id) => data.cycles.find((cycle) => cycle.id === id)?.name ?? id),
    },
    confidenceDistribution: Object.entries(confidence).map(([confidence, count]) => ({ confidence, count })),
    overdueGoals,
    staleKeyResults: staleKeyResults,
    checkInTrend: [...trend.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
    cycleHistory,
    periodComparisons: comparisons,
    goals: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      ownerName: goal.ownerName,
      teamName: goal.teamName,
      progress: goal.progress === null ? null : Number(goal.progress),
      dueDate: goal.dueDate,
      keyResultCount: goal.keyResults.length,
    })),
  };
}
