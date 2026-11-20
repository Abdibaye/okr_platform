import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { loadEditableKeyResult } from "@/server/archive";
import { refreshObjectiveProgress } from "@/server/okr-mutations";
import { recordAudit } from "@/server/people";
import { clearStaleRequests } from "@/server/reminders";
import { keyResults } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  try {
    const keyResult = await loadEditableKeyResult(context, id);
    await getDb().transaction(async (transaction) => {
      await transaction.update(keyResults).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(keyResults.id, keyResult.id));
      await refreshObjectiveProgress(transaction, keyResult.objectiveId, context.companyId);
      await recordAudit(transaction, {
        companyId: context.companyId,
        actorId: context.session.user.id,
        action: "key_result_archived",
        entityType: "key_result",
        entityId: keyResult.id,
        reason: `Archived key result "${keyResult.title}"`,
      });
      await clearStaleRequests(transaction, context.companyId);
    });
    return NextResponse.json({ archived: true });
  } catch (error) {
    if (error instanceof Error && "status" in error) return errorResponse(error.message, (error as { status: number }).status);
    return errorResponse("Could not archive the key result.", 500);
  }
}
