import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { loadVisibleCycleGoals } from "@/server/goal-data";
import { okrCycles } from "@/server/schema";

export const dynamic = "force-dynamic";

const round = (value: number) => Math.round(value * 100) / 100;

/** Cycle summary built only from goals the viewer can see. Defaults to the latest open (or latest) cycle. */
export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  let cycleId = new URL(request.url).searchParams.get("cycleId");
  if (!cycleId) {
    const cycles = await getDb().select({ id: okrCycles.id, status: okrCycles.status }).from(okrCycles)
      .where(and(eq(okrCycles.companyId, context.companyId)))
      .orderBy(desc(okrCycles.startDate));
    cycleId = (cycles.find((cycle) => cycle.status === "open") ?? cycles[0])?.id ?? null;
    if (!cycleId) return NextResponse.json({ cycle: null, summary: null, goals: [] });
  }
  if (!isUuid(cycleId)) return errorResponse("Cycle not found.", 404);
  const data = await loadVisibleCycleGoals(context, cycleId);
  if (!data) return errorResponse("Cycle not found.", 404);

  const { cycle, goals } = data;
  const keyResults = goals.flatMap((goal) => goal.keyResults);
  const scored = goals.filter((goal) => goal.progress !== null);
  const today = new Date().toISOString().slice(0, 10);
  const count = <T,>(items: T[], key: (item: T) => string) => items.reduce<Record<string, number>>((totals, item) => {
    totals[key(item)] = (totals[key(item)] ?? 0) + 1;
    return totals;
  }, {});

  return NextResponse.json({
    cycle: { id: cycle.id, name: cycle.name, startDate: cycle.startDate, endDate: cycle.endDate, status: cycle.status },
    summary: {
      goalCount: goals.length,
      keyResultCount: keyResults.length,
      averageProgress: scored.length ? round(scored.reduce((total, goal) => total + Number(goal.progress), 0) / scored.length) : null,
      goalsByStatus: count(goals, (goal) => goal.status),
      keyResultsByConfidence: count(keyResults, (result) => result.confidence),
      overdueGoals: goals.filter((goal) => goal.dueDate && goal.dueDate < today && Number(goal.progress ?? 0) < 100 && goal.status !== "completed" && goal.status !== "cancelled").length,
    },
    goals: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      level: goal.level,
      status: goal.status,
      ownerName: goal.ownerName,
      progress: goal.progress === null ? null : Number(goal.progress),
      dueDate: goal.dueDate,
      keyResultCount: goal.keyResults.length,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
