import { NextResponse } from "next/server";
import { contextOr401, isResponse, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { deliverNotificationEmails, notifyNewOwners } from "@/server/notifications";
import { validateOkrCsv } from "@/server/okr-import";
import { calculateProgress } from "@/server/okr-math";
import { refreshObjectiveProgress } from "@/server/okr-mutations";
import { recordAudit } from "@/server/people";
import { keyResults, objectives } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const csv = typeof body?.csv === "string" ? body.csv : "";
  const actorId = context.session.user.id;
  const actorName = context.session.user.name || "Someone";
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

  const result = await getDb().transaction(async (transaction) => {
    const objectiveIdByTitle = new Map<string, string>();
    const objectivePlans = [...new Map(validation.plans.map((plan) => [plan.objectiveTitle.toLowerCase(), plan])).values()];
    const importedKeyResults: Array<{ id: string; plan: (typeof validation.plans)[number] }> = [];
    for (const plan of objectivePlans) {
      const [objective] = await transaction.insert(objectives).values({
        companyId: context.companyId,
        cycleId: plan.cycleId,
        title: plan.objectiveTitle,
        description: plan.objectiveDescription,
        level: plan.level,
        teamId: plan.teamId,
        ownerId: plan.ownerId,
        dueDate: plan.dueDate,
        visibility: plan.visibility,
        parentObjectiveId: plan.parentObjectiveId,
        createdBy: actorId,
      }).returning({ id: objectives.id });
      objectiveIdByTitle.set(plan.objectiveTitle.toLowerCase(), objective.id);
    }

    for (const plan of validation.plans) {
      const progress = calculateProgress(plan.baseline, plan.target, plan.current, plan.direction, plan.metricType);
      const [created] = await transaction.insert(keyResults).values({
        companyId: context.companyId,
        objectiveId: objectiveIdByTitle.get(plan.objectiveTitle.toLowerCase())!,
        title: plan.krTitle,
        metricType: plan.metricType,
        direction: plan.direction,
        unit: plan.unit,
        baseline: plan.baseline.toString(),
        target: plan.target.toString(),
        current: plan.current.toString(),
        progress: progress.toFixed(2),
        ownerId: plan.ownerId,
      }).returning({ id: keyResults.id });
      importedKeyResults.push({ id: created.id, plan });
    }
    for (const objectiveId of objectiveIdByTitle.values()) await refreshObjectiveProgress(transaction, objectiveId, context.companyId);
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId,
      action: "okrs_imported",
      entityType: "import",
      entityId: "okr-import",
      reason: `Imported ${objectivePlans.length} objectives and ${validation.plans.length} key results from CSV`,
      details: { objectiveCount: objectivePlans.length, keyResultCount: validation.plans.length },
    });
    const notified = await notifyNewOwners(transaction, context.companyId, actorId, actorName, "import", [
      ...objectivePlans.map((plan) => ({
        recipientId: plan.ownerId,
        objectiveId: objectiveIdByTitle.get(plan.objectiveTitle.toLowerCase())!,
        goalTitle: plan.objectiveTitle,
      })),
      ...importedKeyResults.map(({ id, plan }) => ({
        recipientId: plan.ownerId,
        objectiveId: objectiveIdByTitle.get(plan.objectiveTitle.toLowerCase())!,
        goalTitle: plan.objectiveTitle,
        keyResultId: id,
        keyResultTitle: plan.krTitle,
      })),
    ]);
    return { objectiveIdByTitle, notified };
  });
  await deliverNotificationEmails(result.notified);

  return NextResponse.json({
    dryRun: false,
    committed: true,
    errors: [],
    plannedObjectives: validation.plannedObjectives,
    plannedKeyResults: validation.plannedKeyResults,
    objectiveIds: [...result.objectiveIdByTitle.values()],
  });
}
