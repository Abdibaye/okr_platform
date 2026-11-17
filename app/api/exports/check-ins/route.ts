import { contextOr401, isResponse } from "@/server/api-utils";
import { csvCell } from "@/server/csv";
import { loadFilteredGoals, parseGoalQueryFilters } from "@/server/goal-query";
import { krCheckIns } from "@/server/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { user } from "@/server/schema";

export const dynamic = "force-dynamic";

const HEADERS = ["objective", "key_result", "author", "effective_date", "value", "progress", "confidence", "note", "blockers", "created_at"] as const;

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const filters = parseGoalQueryFilters(new URL(request.url).searchParams);
  const data = await loadFilteredGoals(context, filters);
  const objectiveIds = data.goals.map((goal) => goal.id);
  const checkIns = objectiveIds.length ? await getDb().select().from(krCheckIns)
    .where(and(eq(krCheckIns.companyId, context.companyId), inArray(krCheckIns.objectiveId, objectiveIds))) : [];
  const goalById = new Map(data.goals.map((goal) => [goal.id, goal]));
  const keyResultById = new Map(data.goals.flatMap((goal) => goal.keyResults.map((result) => [result.id, result] as const)));
  const authorIds = [...new Set(checkIns.map((checkIn) => checkIn.authorId))];
  const authors = authorIds.length ? await getDb().select({ id: user.id, name: user.name }).from(user)
    .where(inArray(user.id, authorIds)) : [];
  const authorById = new Map(authors.map((author) => [author.id, author.name]));
  const rows: (string | number | null)[][] = [[...HEADERS]];
  for (const checkIn of checkIns) {
    const goal = goalById.get(checkIn.objectiveId);
    const keyResult = keyResultById.get(checkIn.keyResultId);
    if (!goal || !keyResult) continue;
    rows.push([goal.title, keyResult.title, authorById.get(checkIn.authorId) ?? checkIn.authorId, checkIn.effectiveDate, checkIn.value, checkIn.progress,
      checkIn.confidence, checkIn.note, checkIn.blockers, checkIn.createdAt.toISOString()]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="check-ins.csv"',
      "Cache-Control": "no-store",
    },
  });
}
