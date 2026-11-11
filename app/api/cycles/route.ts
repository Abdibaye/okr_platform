import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { hasRole } from "@/server/request-context";
import { getDb } from "@/server/db";
import { okrCycles } from "@/server/schema";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can create cycles.", 403);

  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  if (!name || name.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return errorResponse("Provide a cycle name and valid start and end dates.", 400);
  }
  if (startDate > endDate || Number.isNaN(Date.parse(startDate)) || Number.isNaN(Date.parse(endDate))) {
    return errorResponse("The cycle end date must be on or after its start date.", 400);
  }

  const [cycle] = await getDb().insert(okrCycles).values({
    companyId: context.companyId,
    name,
    startDate,
    endDate,
    createdBy: context.session.user.id,
  }).onConflictDoNothing().returning();
  if (!cycle) return errorResponse("A cycle with that name already exists.", 409);
  return NextResponse.json({ cycle }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) {
    return errorResponse("Only managers and admins can open cycles.", 403);
  }
  const body = await readJson(request);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || !isUuid(id)) return errorResponse("Select a valid cycle to open.", 400);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
    return errorResponse("Invalid cycle version.", 400);
  }

  const conditions = [
    eq(okrCycles.id, id),
    eq(okrCycles.companyId, context.companyId),
    eq(okrCycles.status, "draft"),
  ];
  if (version !== undefined) conditions.push(eq(okrCycles.version, version));

  const [cycle] = await getDb().update(okrCycles)
    .set({ status: "open", version: sql`${okrCycles.version} + 1`, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  if (!cycle) {
    const [existing] = await getDb().select({ status: okrCycles.status, version: okrCycles.version })
      .from(okrCycles)
      .where(and(eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId)))
      .limit(1);
    if (!existing) return errorResponse("Cycle not found.", 404);
    if (existing.status !== "draft") return errorResponse("Cycle is already opened or closed.", 409);
    return NextResponse.json({ error: "This cycle changed elsewhere. Reload before saving.", version: existing.version }, { status: 409 });
  }
  return NextResponse.json({ cycle });
}
