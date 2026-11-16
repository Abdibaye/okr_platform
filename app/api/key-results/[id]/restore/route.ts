import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { recordAudit } from "@/server/people";
import { keyResults } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  const [keyResult] = await getDb().select().from(keyResults)
    .where(and(eq(keyResults.id, id), eq(keyResults.companyId, context.companyId))).limit(1);
  if (!keyResult || !keyResult.archivedAt) return errorResponse("Archived key result not found.", 404);
  await getDb().transaction(async (transaction) => {
    await transaction.update(keyResults).set({ archivedAt: null, updatedAt: new Date() }).where(eq(keyResults.id, keyResult.id));
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "key_result_restored",
      entityType: "key_result",
      entityId: keyResult.id,
      reason: `Restored key result "${keyResult.title}"`,
    });
  });
  return NextResponse.json({ restored: true });
}
