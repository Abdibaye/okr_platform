import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { recordAudit } from "@/server/people";
import { okrCycles } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role !== "admin" && context.role !== "manager") return errorResponse("Only managers and admins can archive cycles.", 403);
  const { id } = await params;
  const [cycle] = await getDb().select().from(okrCycles)
    .where(and(eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId))).limit(1);
  if (!cycle) return errorResponse("Cycle not found.", 404);
  await getDb().transaction(async (transaction) => {
    await transaction.update(okrCycles).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(okrCycles.id, cycle.id));
    await recordAudit(transaction, {
      companyId: context.companyId,
      cycleId: cycle.id,
      actorId: context.session.user.id,
      action: "cycle_archived",
      entityType: "cycle",
      entityId: cycle.id,
      reason: `Archived cycle "${cycle.name}"`,
    });
  });
  return NextResponse.json({ archived: true });
}
