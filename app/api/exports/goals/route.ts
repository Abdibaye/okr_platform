import { contextOr401, errorResponse, isResponse, isUuid } from "@/server/api-utils";
import { loadVisibleCycleGoals } from "@/server/goal-data";

export const dynamic = "force-dynamic";

const HEADERS = ["Cycle", "Objective", "Owner", "Status", "Visibility", "Key Result", "KR Owner", "Metric Type", "Direction", "Baseline", "Target", "Current", "Progress %"];

function csvCell(value: string | number | null) {
  let text = value === null ? "" : String(value);
  // Neutralise spreadsheet formulas in user-entered text.
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV of the cycle's goals and key results that the viewer can see. */
export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const cycleId = new URL(request.url).searchParams.get("cycleId") ?? "";
  if (!isUuid(cycleId)) return errorResponse("Cycle not found.", 404);
  const data = await loadVisibleCycleGoals(context, cycleId);
  if (!data) return errorResponse("Cycle not found.", 404);

  const rows: (string | number | null)[][] = [HEADERS];
  for (const goal of data.goals) {
    const base = [data.cycle.name, goal.title, goal.ownerName, goal.status, goal.visibility];
    if (!goal.keyResults.length) rows.push([...base, "", "", "", "", "", "", "", goal.progress ?? "0"]);
    for (const result of goal.keyResults) {
      rows.push([...base, result.title, result.ownerName, result.metricType, result.direction, result.baseline, result.target, result.current, result.progress]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `${data.cycle.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cycle"}-okrs.csv`;
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
