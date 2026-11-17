import { NextResponse } from "next/server";
import { contextOr401, isResponse } from "@/server/api-utils";
import { parseGoalQueryFilters } from "@/server/goal-query";
import { buildReport } from "@/server/reporting";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const filters = parseGoalQueryFilters(new URL(request.url).searchParams);
  const report = await buildReport(context, filters);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
