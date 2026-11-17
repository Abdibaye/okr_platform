import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { recordAudit } from "@/server/people";
import { objectives } from "@/server/schema";
import { InputError } from "@/server/objectives";
import { canManagePrivacy, loadObjectiveAccessFacts, viewerFromContext } from "@/server/org-access";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  try {
    const [objective] = await getDb().select().from(objectives)
      .where(and(eq(objectives.id, id), eq(objectives.companyId, context.companyId))).limit(1);
    if (!objective || !objective.archivedAt) throw new InputError("Archived goal not found.", 404);
    const facts = await loadObjectiveAccessFacts(getDb(), context.companyId, id, objective.ownerId);
    if (!canManagePrivacy(objective, viewerFromContext(context), facts)) throw new InputError("Only the goal owner, managers and admins can restore a goal.", 403);
    await getDb().transaction(async (transaction) => {
      await transaction.update(objectives).set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(objectives.id, id), isNotNull(objectives.archivedAt)));
      await recordAudit(transaction, {
        companyId: context.companyId,
        cycleId: objective.cycleId,
        actorId: context.session.user.id,
        action: "objective_restored",
        entityType: "objective",
        entityId: id,
        reason: `Restored goal "${objective.title}"`,
      });
    });
    return NextResponse.json({ restored: true });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    return errorResponse("Could not restore the goal.", 500);
  }
}
