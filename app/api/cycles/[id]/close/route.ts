import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { hasRole } from "@/server/request-context";
import { getDb } from "@/server/db";
import { auditLogs, okrCycles } from "@/server/schema";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can close cycles.", 403);

  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Cycle not found.", 404);

  const body = await readJson(request);
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "Closed by manager";
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
    return errorResponse("Invalid cycle version.", 400);
  }
  let finalReflection: string | undefined;
  if (typeof body?.finalReflection === "string") {
    finalReflection = body.finalReflection.trim();
    if (finalReflection.length > 10000) {
      return errorResponse("Final reflection must be 10,000 characters or fewer.", 400);
    }
  }

  const database = getDb();
  const [cycle] = await database.select({
    status: okrCycles.status,
    version: okrCycles.version,
  }).from(okrCycles).where(and(
    eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId),
  )).limit(1);
  if (!cycle) return errorResponse("Cycle not found.", 404);
  if (cycle.status === "closed") return errorResponse("Cycle is already closed.", 409);
  if (cycle.status !== "open") return errorResponse("Only open cycles can be closed.", 409);

  const closed = await database.transaction(async (transaction) => {
    const conditions = [
      eq(okrCycles.id, id),
      eq(okrCycles.companyId, context.companyId),
      eq(okrCycles.status, "open"),
    ];
    if (version !== undefined) conditions.push(eq(okrCycles.version, version));

    const updates: { status: "closed"; version: ReturnType<typeof sql<number>>; updatedAt: Date; finalReflection?: string } = {
      status: "closed",
      version: sql<number>`${okrCycles.version} + 1`,
      updatedAt: new Date(),
    };
    if (finalReflection !== undefined) updates.finalReflection = finalReflection;

    const [updated] = await transaction.update(okrCycles).set(updates).where(and(...conditions)).returning();
    if (!updated) return null;

    await transaction.insert(auditLogs).values({
      companyId: context.companyId,
      cycleId: id,
      actorId: context.session.user.id,
      action: "cycle_closed",
      reason,
      details: finalReflection !== undefined ? { finalReflectionLength: finalReflection.length } : {},
    });
    return updated;
  });

  if (!closed) {
    const [latest] = await database.select({ status: okrCycles.status, version: okrCycles.version })
      .from(okrCycles)
      .where(and(eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId)))
      .limit(1);
    if (!latest) return errorResponse("Cycle not found.", 404);
    if (latest.status === "closed") return errorResponse("Cycle is already closed.", 409);
    return NextResponse.json({ error: "This cycle changed elsewhere. Reload before closing.", version: latest.version }, { status: 409 });
  }

  return NextResponse.json({ status: "closed", cycle: closed });
}
