import { contextOr401, isResponse } from "@/server/api-utils";
import { csvCell } from "@/server/csv";
import { loadFilteredGoals, parseGoalQueryFilters } from "@/server/goal-query";
import { okrCycles } from "@/server/schema";

export const dynamic = "force-dynamic";

const HEADERS = [
  "cycle_name", "objective_title", "objective_description", "level", "team_name", "owner_email", "due_date",
  "visibility", "parent_objective_title", "kr_title", "metric_type", "direction", "baseline", "target", "current", "unit", "kr_owner_email", "progress",
] as const;

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const filters = parseGoalQueryFilters(new URL(request.url).searchParams);
  if (!filters.cycleId) {
    const [latest] = await (await import("@/server/db")).getDb().select({ id: okrCycles.id }).from(okrCycles)
      .orderBy(okrCycles.startDate).limit(1);
    filters.cycleId = latest?.id;
  }
  const data = await loadFilteredGoals(context, filters);
  const objectiveById = new Map(data.goals.map((goal) => [goal.id, goal]));
  const rows: (string | number | null)[][] = [HEADERS];
  for (const goal of data.goals) {
    const cycle = data.cycles.find((candidate) => candidate.id === goal.cycleId);
    const parent = goal.parentObjectiveId ? objectiveById.get(goal.parentObjectiveId) : undefined;
    if (!goal.keyResults.length) {
      rows.push([cycle?.name ?? "", goal.title, goal.description, goal.level, goal.teamName ?? "", goal.ownerEmail ?? "",
        goal.dueDate ?? "", goal.visibility, parent?.title ?? "", "", "", "", "", "", "", "", goal.progress ?? ""]);
    }
    for (const result of goal.keyResults) {
      rows.push([cycle?.name ?? "", goal.title, goal.description, goal.level, goal.teamName ?? "", goal.ownerEmail ?? "",
        goal.dueDate ?? "", goal.visibility, parent?.title ?? "", result.title, result.metricType, result.direction,
        result.baseline, result.target, result.current, result.unit, result.ownerEmail ?? "", result.progress]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="okrs.csv"',
      "Cache-Control": "no-store",
    },
  });
}
