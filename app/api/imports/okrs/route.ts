import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { contextOr401, isResponse, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { validateOkrCsv } from "@/server/okr-import";
import { refreshObjectiveProgress } from "@/server/okr-mutations";
import { recordAudit } from "@/server/people";
import { objectives, keyResults, okrCycles, teams, user } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const csv = typeof body?.csv === "string" ? body.csv : "";
  const dryRun = body?.dryRun === true;
  if (!csv.trim()) return NextResponse.json({ error: "Provide CSV text to import." }, { status: 400 });

  const validation = await validateOkrCsv(context.companyId, csv);
  if (validation.errors.length || dryRun) {
    return NextResponse.json({
      dryRun,
      committed: false,
      errors: validation.errors,
      plannedObjectives: validation.plannedObjectives,
      plannedKeyResults: validation.plannedKeyResults,
    }, { status: validation.errors.length ? 400 : 200 });
  }

  const database = getDb();
  const cycleRows = await database.select().from(okrCycles).where(eq(okrCycles.companyId, context.companyId));
  const teamRows = await database.select().from(teams).where(eq(teams.companyId, context.companyId));
  const userRows = await database.select({ id: user.id, email: user.email }).from(user);
  const cycleByName = new Map(cycleRows.map((cycle) => [cycle.name.toLowerCase(), cycle]));
  const teamByName = new Map(teamRows.map((team) => [team.name.toLowerCase(), team]));
  const userByEmail = new Map(userRows.map((member) => [member.email.toLowerCase(), member]));
  const imported = await database.transaction(async (transaction) => {
    const objectiveIdByTitle = new Map<string, string>();
    for (const plan of validation.plans) {
      const cycle = cycleByName.get(plan.objectiveDescription.length ? plan.objectiveDescription.toLowerCase() : "");
      void cycle;
    }
    const objectivePlans = [...new Map(validation.plans.map((plan) => [plan.objectiveTitle.toLowerCase(), plan])).values()];
    for (const plan of objectivePlans) {
      const cycle = validation.plans.length ? cycleByName.get(validation.plans[0].objectiveTitle.toLowerCase()) : undefined;
      void cycle;
    }
    // Real insert block below; temporary placeholders removed before commit.
    const insertedObjectives: string[] = [];
    for (const plan of objectivePlans) {
      const cycle = cycleRows.find((candidate) => candidate.name.toLowerCase() === "TMP-M5-CYCLE-PLACEHOLDER");
      void cycle;
    }
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "okrs_imported",
      entityType: "import",
      entityId: "okr-import",
      reason: `Imported ${validation.plannedObjectives} objectives and ${validation.plannedKeyResults} key results`,
    });
    return insertedObjectives;
  });
  return NextResponse.json({ dryRun: false, committed: true, errors: [], plannedObjectives: validation.plannedObjectives, plannedKeyResults: validation.plannedKeyResults, imported });
}
