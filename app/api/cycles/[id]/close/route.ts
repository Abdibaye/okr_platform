import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, readJson } from "@/server/api-utils";
import { hasRole } from "@/server/request-context";
import { getDb } from "@/server/db";
import { auditLogs, okrCycles } from "@/server/schema";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can close cycles.", 403);
  const { id } = await params;
  const [cycle] = await getDb().select().from(okrCycles).where(and(
    eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId),
  )).limit(1);
  if (!cycle) return errorResponse("Cycle not found.", 404);
  if (cycle.status === "closed") return errorResponse("Cycle is already closed.", 409);
  const body = await readJson(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "Closed by manager";

  await getDb().transaction(async (transaction) => {
    await transaction.update(okrCycles).set({ status: "closed", updatedAt: new Date() })
      .where(and(eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId), eq(okrCycles.status, "open")));
    await transaction.insert(auditLogs).values({
      companyId: context.companyId,
      cycleId: id,
      actorId: context.session.user.id,
      action: "cycle_closed",
      reason: reason || "Closed by manager",
    });
  });
  return NextResponse.json({ status: "closed" });
}
