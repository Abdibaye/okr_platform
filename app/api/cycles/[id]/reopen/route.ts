import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { auditLogs, okrCycles } from "@/server/schema";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role !== "admin") return errorResponse("Only an admin can reopen a cycle.", 403);
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Cycle not found.", 404);

  const body = await readJson(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) return errorResponse("Enter a reason of at least 3 characters.", 400);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
    return errorResponse("Invalid cycle version.", 400);
  }

  const result = await getDb().transaction(async (transaction) => {
    const conditions = [
      eq(okrCycles.id, id),
      eq(okrCycles.companyId, context.companyId),
      eq(okrCycles.status, "closed"),
    ];
    if (version !== undefined) conditions.push(eq(okrCycles.version, version));

    const [cycle] = await transaction.update(okrCycles).set({
      status: "open",
      version: sql`${okrCycles.version} + 1`,
      updatedAt: new Date(),
    }).where(and(...conditions)).returning();
    if (!cycle) return null;

    await transaction.insert(auditLogs).values({
      companyId: context.companyId,
      cycleId: id,
      actorId: context.session.user.id,
      action: "cycle_reopened",
      reason,
    });
    return cycle;
  });

  if (!result) {
    const [cycle] = await getDb().select({ status: okrCycles.status, version: okrCycles.version }).from(okrCycles).where(and(
      eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId),
    )).limit(1);
    if (!cycle) return errorResponse("Cycle not found.", 404);
    if (cycle.status !== "closed") return errorResponse("Cycle is already open or still a draft.", 409);
    return NextResponse.json({ error: "This cycle changed elsewhere. Reload before reopening.", version: cycle.version }, { status: 409 });
  }
  return NextResponse.json({ status: "open", reason, cycle: result });
}
