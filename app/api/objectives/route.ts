import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { hasRole } from "@/server/request-context";
import { getDb } from "@/server/db";
import { objectives, okrCycles } from "@/server/schema";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can create objectives.", 403);
  const body = await readJson(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const cycleId = typeof body?.cycleId === "string" ? body.cycleId : "";
  if (!title || title.length > 240 || description.length > 10000 || !cycleId || !isUuid(cycleId)) {
    return errorResponse("Provide an objective title and valid cycle.", 400);
  }

  const database = getDb();
  const [cycle] = await database.select({ status: okrCycles.status }).from(okrCycles).where(and(
    eq(okrCycles.id, cycleId), eq(okrCycles.companyId, context.companyId),
  )).limit(1);
  if (!cycle) return errorResponse("Cycle not found.", 404);
  if (cycle.status === "closed") return errorResponse("This cycle is closed; objectives cannot be created.", 403);
  if (cycle.status !== "open") return errorResponse("Open the cycle before creating objectives.", 403);

  const [objective] = await database.insert(objectives).values({
    companyId: context.companyId,
    cycleId,
    title,
    description,
    createdBy: context.session.user.id,
  }).returning();
  return NextResponse.json({ objective }, { status: 201 });
}
