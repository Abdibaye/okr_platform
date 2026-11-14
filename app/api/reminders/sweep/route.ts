import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { runReminderSweep } from "@/server/reminders";

export const dynamic = "force-dynamic";

function bearerMatches(request: Request) {
  const secret = process.env.REMINDER_SWEEP_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Creates due reminders. A scheduler calls it with `Authorization: Bearer $REMINDER_SWEEP_SECRET`
 * (all companies); an admin can also run it from the Cycles page for their own company.
 */
export async function POST(request: Request) {
  if (bearerMatches(request)) {
    return NextResponse.json(await runReminderSweep(null));
  }
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role !== "admin") return errorResponse("Only admins can run reminders.", 403);
  return NextResponse.json(await runReminderSweep(context.companyId));
}
