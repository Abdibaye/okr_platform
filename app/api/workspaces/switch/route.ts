import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { companies, companyMemberships } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;

  const body = await request.json().catch(() => ({}));
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";

  if (!companyId) {
    return errorResponse("Company ID is required.", 400);
  }

  const database = getDb();
  const [membership] = await database.select({
    companyId: companyMemberships.companyId,
    name: companies.name,
    role: companyMemberships.role,
  }).from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.userId, context.session.user.id),
      eq(companyMemberships.isActive, true),
    ))
    .limit(1);

  if (!membership) {
    return errorResponse("You do not have access to this workspace.", 403);
  }

  const response = NextResponse.json({ ok: true, company: membership });
  response.cookies.set({
    name: "active_company_id",
    value: membership.companyId,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
