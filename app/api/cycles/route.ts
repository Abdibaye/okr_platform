import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse, readJson } from "@/server/api-utils";
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
  if (!id) return errorResponse("Select a cycle to open.", 400);

  const [cycle] = await getDb().update(okrCycles)
    .set({ status: "open", updatedAt: new Date() })
    .where(and(eq(okrCycles.id, id), eq(okrCycles.companyId, context.companyId), eq(okrCycles.status, "draft")))
    .returning();
  if (!cycle) return errorResponse("Cycle not found or already opened.", 404);
  return NextResponse.json({ cycle });
}
