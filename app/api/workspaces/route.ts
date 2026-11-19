import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { quarterlyPresetDates } from "@/server/okr-math";
import { recordAudit } from "@/server/people";
import { companies, companyMemberships, okrCycles } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;

  const body = await request.json().catch(() => ({}));
  const rawName = typeof body.name === "string" ? body.name.trim() : "";

  if (rawName.length < 2 || rawName.length > 60) {
    return errorResponse("Workspace name must be between 2 and 60 characters.", 400);
  }

  const database = getDb();
  const userId = context.session.user.id;

  try {
    const result = await database.transaction(async (transaction) => {
      // 1. Create company record
      const [newCompany] = await transaction.insert(companies).values({
        name: rawName,
      }).returning({ id: companies.id, name: companies.name });

      // 2. Grant creator Admin role
      await transaction.insert(companyMemberships).values({
        companyId: newCompany.id,
        userId,
        role: "admin",
        isActive: true,
      });

      // 3. Seed starter open quarterly cycle
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      const preset = quarterlyPresetDates(now.getFullYear(), quarter);
      await transaction.insert(okrCycles).values({
        companyId: newCompany.id,
        name: preset.name,
        startDate: preset.startDate,
        endDate: preset.endDate,
        status: "open",
        createdBy: userId,
      });

      // 4. Record audit log
      await recordAudit(transaction, {
        companyId: newCompany.id,
        actorId: userId,
        action: "company_created",
        entityType: "company",
        entityId: newCompany.id,
        reason: `Created workspace "${newCompany.name}"`,
      });

      return newCompany;
    });

    const response = NextResponse.json({
      ok: true,
      company: { id: result.id, name: result.name, role: "admin" },
    });

    response.cookies.set({
      name: "active_company_id",
      value: result.id,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Could not create workspace.", 500);
  }
}
