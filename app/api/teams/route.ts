import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { recordAudit } from "@/server/people";
import { hasRole } from "@/server/request-context";
import { companyMemberships, teamMemberships, teams, user } from "@/server/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can view teams.", 403);
  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";

  const database = getDb();
  const teamRows = await database.select().from(teams).where(and(
    eq(teams.companyId, context.companyId),
    includeArchived ? undefined : isNull(teams.archivedAt),
  )).orderBy(asc(teams.name));
  const teamIds = teamRows.map((team) => team.id);
  const memberRows = teamIds.length
    ? await database.select({
      teamId: teamMemberships.teamId,
      userId: teamMemberships.userId,
      isLead: teamMemberships.isLead,
      name: user.name,
      email: user.email,
    }).from(teamMemberships)
      .innerJoin(user, eq(user.id, teamMemberships.userId))
      .where(and(eq(teamMemberships.companyId, context.companyId), inArray(teamMemberships.teamId, teamIds)))
      .orderBy(asc(user.name))
    : [];

  const membersByTeam = new Map<string, typeof memberRows>();
  for (const row of memberRows) {
    const list = membersByTeam.get(row.teamId) ?? [];
    list.push(row);
    membersByTeam.set(row.teamId, list);
  }

  return NextResponse.json({
    teams: teamRows.map((team) => ({ ...team, members: membersByTeam.get(team.id) ?? [] })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin", "manager"])) return errorResponse("Only managers and admins can create teams.", 403);

  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const leadUserId = typeof body?.leadUserId === "string" && body.leadUserId ? body.leadUserId : null;
  if (!name || name.length > 120) return errorResponse("Team name must be 1–120 characters.", 400);
  if (description.length > 2000) return errorResponse("Description must be 2,000 characters or fewer.", 400);

  const database = getDb();
  if (leadUserId) {
    const [lead] = await database.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, context.companyId),
      eq(companyMemberships.userId, leadUserId),
      eq(companyMemberships.isActive, true),
    )).limit(1);
    if (!lead) return errorResponse("Team lead must be an active workspace member.", 400);
  }

  const created = await database.transaction(async (transaction) => {
    const [team] = await transaction.insert(teams).values({
      companyId: context.companyId,
      name,
      description,
      leadUserId,
    }).onConflictDoNothing().returning();
    if (!team) return null;
    if (leadUserId) {
      await transaction.insert(teamMemberships).values({
        companyId: context.companyId,
        teamId: team.id,
        userId: leadUserId,
        isLead: true,
      });
    }
    await recordAudit(transaction, {
      companyId: context.companyId,
      actorId: context.session.user.id,
      action: "team_created",
      entityType: "team",
      entityId: team.id,
      reason: `Team "${name}" created`,
      details: { leadUserId },
    });
    return team;
  });
  if (!created) return errorResponse("A team with this name already exists (it may be archived).", 409);
  return NextResponse.json({ team: created }, { status: 201 });
}
