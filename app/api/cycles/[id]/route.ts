import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { hasRole } from "@/server/request-context";
import { okrCycles } from "@/server/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) {
    return errorResponse("Only managers and admins can update cycle reflections.", 403);
  }

  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Cycle not found.", 404);

  const body = await readJson(request);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    return errorResponse("Include the current cycle version to save your changes.", 400);
  }
  if (typeof body?.finalReflection !== "string") {
    return errorResponse("Provide final reflection text to save.", 400);
  }
  const finalReflection = body.finalReflection.trim();
  if (finalReflection.length > 10000) {
    return errorResponse("Final reflection must be 10,000 characters or fewer.", 400);
  }

  const database = getDb();
  const [updated] = await database.update(okrCycles).set({
    finalReflection,
    version: (version as number) + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(okrCycles.id, id),
    eq(okrCycles.companyId, context.companyId),
    eq(okrCycles.version, version as number),
    eq(okrCycles.status, "open"),
  )).returning();

  if (updated) return NextResponse.json({ cycle: updated });

  const [current] = await database.select({
    status: okrCycles.status,
    version: okrCycles.version,
    finalReflection: okrCycles.finalReflection,
  }).from(okrCycles).where(and(
    eq(okrCycles.id, id),
    eq(okrCycles.companyId, context.companyId),
  )).limit(1);

  if (!current) return errorResponse("Cycle not found.", 404);
  if (current.status === "closed") return errorResponse("This cycle is closed; final reflections cannot be edited.", 403);
  if (current.status === "draft") return errorResponse("Open the cycle before saving a final reflection.", 403);
  return NextResponse.json(
    { error: "This cycle changed elsewhere. Reload before saving.", version: current.version, finalReflection: current.finalReflection },
    { status: 409 },
  );
}
