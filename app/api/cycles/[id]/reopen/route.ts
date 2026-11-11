import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, readJson } from "@/server/api-utils";
import { hasRole } from "@/server/request-context";
import { getDb } from "@/server/db";
import { auditLogs, okrCycles } from "@/server/schema";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role !== "admin") return errorResponse("Only an admin can reopen a cycle.", 403);
  const { id } = await params;
  const body = await readJson(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) return errorResponse("Enter a reason of at least 3 characters.", 400);

  const result = await getDb().transaction(async (transaction) => {
    const [cycle] = await transaction.update(okrCycles).set({ status: "open", updatedAt: new Date() })
      .where(and(
        eq(okrCycles.id, id),
        eq(okrCycles.companyId, context.companyId),
        eq(okrCycles.status, "closed"),
      )).returning({ id: okrCycles.id });
    if (!cycle) return false;
    await transaction.insert(auditLogs).values({
      companyId: context.companyId,
      cycleId: id,
      actorId: context.session.user.id,
      action: "cycle_reopened",
      reason,
    });
    return true;
  });
  if (!result) {
    const [cycle] = await getDb().select({ id: okrCycles.id }).from(okrCycles).where(and(
      eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId),
    )).limit(1);
    return cycle ? errorResponse("Cycle is already open.", 409) : errorResponse("Cycle not found.", 404);
  }
  return NextResponse.json({ status: "open", reason });
}
