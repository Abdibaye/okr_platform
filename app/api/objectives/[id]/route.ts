import { and, eq, exists } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { objectives, okrCycles } from "@/server/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Objective not found.", 404);

  const body = await readJson(request);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    return errorResponse("Include the current objective version to save your changes.", 400);
  }
  const updates: { title?: string; description?: string; version?: number; updatedAt?: Date } = {};
  if (typeof body?.title === "string") {
    const title = body.title.trim();
    if (!title || title.length > 240) return errorResponse("Objective title must be 1–240 characters.", 400);
    updates.title = title;
  }
  if (typeof body?.description === "string") {
    if (body.description.length > 10000) return errorResponse("Description is too long.", 400);
    updates.description = body.description.trim();
  }
  if (!updates.title && updates.description === undefined) return errorResponse("Provide a title or description to update.", 400);
  updates.version = (version as number) + 1;
  updates.updatedAt = new Date();

  const database = getDb();
  const [updated] = await database.update(objectives).set(updates).where(and(
    eq(objectives.id, id),
    eq(objectives.companyId, context.companyId),
    eq(objectives.version, version as number),
    exists(database.select({ id: okrCycles.id }).from(okrCycles).where(and(
      eq(okrCycles.id, objectives.cycleId),
      eq(okrCycles.companyId, context.companyId),
      eq(okrCycles.status, "open"),
    ))),
  )).returning();

  if (updated) return NextResponse.json({ objective: updated });
  const [current] = await database.select({
    id: objectives.id,
    title: objectives.title,
    description: objectives.description,
    version: objectives.version,
    cycleStatus: okrCycles.status,
  }).from(objectives).innerJoin(okrCycles, eq(objectives.cycleId, okrCycles.id)).where(and(
    eq(objectives.id, id), eq(objectives.companyId, context.companyId), eq(okrCycles.companyId, context.companyId),
  )).limit(1);
  if (!current) return errorResponse("Objective not found.", 404);
  if (current.cycleStatus === "closed") return errorResponse("This cycle is closed; objectives cannot be changed.", 403);
  if (current.cycleStatus !== "open") return errorResponse("Open the cycle before editing objectives.", 403);
  return NextResponse.json(
    {
      error: "This objective changed elsewhere. Reload before saving.",
      version: current.version,
      title: current.title,
      description: current.description,
    },
    { status: 409 },
  );
}
