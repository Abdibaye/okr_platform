import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { archiveObjectiveAndKeyResults, loadEditableObjective } from "@/server/archive";
import { recordAudit } from "@/server/people";
import { clearStaleRequests } from "@/server/reminders";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  try {
    const objective = await loadEditableObjective(context, id);
    await getDb().transaction(async (transaction) => {
      await archiveObjectiveAndKeyResults(transaction, objective.id);
      await recordAudit(transaction, {
        companyId: context.companyId,
        cycleId: objective.cycleId,
        actorId: context.session.user.id,
        action: "objective_archived",
        entityType: "objective",
        entityId: objective.id,
        reason: `Archived goal "${objective.title}"`,
      });
      await clearStaleRequests(transaction, context.companyId);
    });
    return NextResponse.json({ archived: true });
  } catch (error) {
    if (error instanceof Error && "status" in error) return errorResponse(error.message, (error as { status: number }).status);
    return errorResponse("Could not archive the goal.", 500);
  }
}
