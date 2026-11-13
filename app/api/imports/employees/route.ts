import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isEmail, isResponse, normalizeEmail, readJson } from "@/server/api-utils";
import { CsvParseError, isBlankRecord, parseCsv, validateEmployeeHeaders } from "@/server/csv";
import { getDb } from "@/server/db";
import {
  createInvitationToken,
  createsReportingLoop,
  deliverInvitation,
  invitationExpiry,
  isRole,
  recordAudit,
  type MembershipRole,
} from "@/server/people";
import { hasRole } from "@/server/request-context";
import { companyMemberships, invitations, teamMemberships, teams, user } from "@/server/schema";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 2000;

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface UpdatePlan {
  kind: "update";
  row: number;
  email: string;
  membershipId: string;
  userId: string;
  set: { role?: MembershipRole; managerId?: string; jobTitle?: string; isActive?: boolean; deactivatedAt?: Date | null };
  teamKey: string | null;
  changes: string[];
}

interface InvitePlan {
  kind: "invite";
  row: number;
  email: string;
  name: string;
  role: MembershipRole;
  managerId: string | null;
  jobTitle: string;
  teamKey: string | null;
  changes: string[];
}

async function readCsv(request: Request) {
  const url = new URL(request.url);
  const queryDryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readJson(request);
    return {
      csv: typeof body?.csv === "string" ? body.csv : null,
      dryRun: queryDryRun || body?.dryRun === true,
    };
  }
  return { csv: await request.text().catch(() => null), dryRun: queryDryRun };
}

export async function POST(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (!hasRole(context.role, ["admin"])) return errorResponse("Only admins can import staff.", 403);

  const { csv, dryRun } = await readCsv(request);
  if (!csv || !csv.trim()) return errorResponse("Provide CSV content with a header row.", 400);
  if (csv.length > MAX_BYTES) return errorResponse("CSV is too large (1 MB maximum).", 413);

  let records;
  try {
    records = parseCsv(csv);
  } catch (error) {
    if (error instanceof CsvParseError) {
      return NextResponse.json({
        error: "The CSV could not be read.",
        created: 0, updated: 0, invited: 0,
        errors: [{ row: error.line, field: "csv", message: error.message }],
      }, { status: 400 });
    }
    throw error;
  }

  const [header, ...dataRecords] = records;
  const headerCheck = validateEmployeeHeaders(header?.fields ?? []);
  if (!headerCheck.ok) {
    return NextResponse.json({
      error: "The CSV header must be: email,name,role,manager_email,team_name,job_title,status",
      created: 0, updated: 0, invited: 0,
      errors: headerCheck.errors.map((message) => ({ row: 1, field: "header", message })),
    }, { status: 400 });
  }
  const rows = dataRecords.filter((record) => !isBlankRecord(record));
  if (rows.length > MAX_ROWS) return errorResponse(`Import at most ${MAX_ROWS} rows at a time.`, 413);
  const { columns } = headerCheck;

  const database = getDb();
  const companyId = context.companyId;
  const actorId = context.session.user.id;

  const memberRows = await database.select({
    membershipId: companyMemberships.id,
    userId: companyMemberships.userId,
    email: user.email,
    role: companyMemberships.role,
    managerId: companyMemberships.managerId,
    jobTitle: companyMemberships.jobTitle,
    isActive: companyMemberships.isActive,
  }).from(companyMemberships)
    .innerJoin(user, eq(user.id, companyMemberships.userId))
    .where(eq(companyMemberships.companyId, companyId));
  const membersByEmail = new Map(memberRows.map((row) => [normalizeEmail(row.email), row]));
  const teamRows = await database.select({ id: teams.id, name: teams.name, archivedAt: teams.archivedAt })
    .from(teams).where(eq(teams.companyId, companyId));
  const teamsByKey = new Map(teamRows.map((team) => [team.name.toLowerCase(), team]));
  const teamLinks = await database.select({ teamId: teamMemberships.teamId, userId: teamMemberships.userId })
    .from(teamMemberships).where(eq(teamMemberships.companyId, companyId));
  const linkedTeams = new Set(teamLinks.map((link) => `${link.teamId}:${link.userId}`));
  const pendingRows = await database.select({ email: invitations.email }).from(invitations).where(and(
    eq(invitations.companyId, companyId),
    eq(invitations.status, "pending"),
    gt(invitations.expiresAt, new Date()),
  ));
  const pendingEmails = new Set(pendingRows.map((row) => row.email));

  // Working state so later rows see the effect of earlier ones (loops, deactivations, last admin).
  const managers = new Map(memberRows.map((row) => [row.userId, row.managerId]));
  const active = new Map(memberRows.map((row) => [row.userId, row.isActive]));
  const roles = new Map(memberRows.map((row) => [row.userId, row.role]));
  let activeAdmins = memberRows.filter((row) => row.isActive && row.role === "admin").length;

  const errors: RowError[] = [];
  const plans: (UpdatePlan | InvitePlan)[] = [];
  const preview: { row: number; email: string; action: "update" | "invite" | "unchanged" | "error"; changes: string[] }[] = [];
  const teamsToCreate = new Map<string, string>();
  const firstRowByEmail = new Map<string, number>();

  for (const record of rows) {
    const row = record.line;
    const value = (column: keyof typeof columns) => (record.fields[columns[column]] ?? "").trim();
    const rowErrors: RowError[] = [];
    const fail = (field: string, message: string) => rowErrors.push({ row, field, message });

    const email = normalizeEmail(value("email"));
    const name = value("name");
    const roleText = value("role").toLowerCase();
    const managerEmail = normalizeEmail(value("manager_email"));
    const teamName = value("team_name");
    const jobTitle = value("job_title");
    const statusText = value("status").toLowerCase() || "active";

    if (!email) fail("email", "Email is required.");
    else if (!isEmail(email)) fail("email", `"${email}" is not a valid email address.`);
    else if (firstRowByEmail.has(email)) fail("email", `Duplicate email; already listed on row ${firstRowByEmail.get(email)}.`);
    if (email && !firstRowByEmail.has(email)) firstRowByEmail.set(email, row);
    if (roleText && !isRole(roleText)) fail("role", `Role "${value("role")}" must be admin, manager or member.`);
    if (statusText !== "active" && statusText !== "inactive") fail("status", `Status "${value("status")}" must be active or inactive.`);
    if (name.length > 160) fail("name", "Name must be 160 characters or fewer.");
    if (jobTitle.length > 160) fail("job_title", "Job title must be 160 characters or fewer.");
    if (teamName.length > 120) fail("team_name", "Team name must be 120 characters or fewer.");

    let managerId: string | null = null;
    if (managerEmail) {
      const manager = membersByEmail.get(managerEmail);
      if (!isEmail(managerEmail)) fail("manager_email", `"${managerEmail}" is not a valid email address.`);
      else if (managerEmail === email) fail("manager_email", "A person cannot be their own manager.");
      else if (!manager) fail("manager_email", `Unknown manager: ${managerEmail} is not a workspace member.`);
      else if (!active.get(manager.userId)) fail("manager_email", `Manager ${managerEmail} is deactivated.`);
      else managerId = manager.userId;
    }

    let teamKey: string | null = null;
    if (teamName) {
      teamKey = teamName.toLowerCase();
      const team = teamsByKey.get(teamKey);
      if (team?.archivedAt) fail("team_name", `Team "${team.name}" is archived; restore it first.`);
    }

    const existing = email ? membersByEmail.get(email) : undefined;
    const role = roleText && isRole(roleText) ? roleText : undefined;
    const changes: string[] = [];

    if (!rowErrors.length && existing) {
      const set: UpdatePlan["set"] = {};
      const currentRole = roles.get(existing.userId) ?? existing.role;
      const isActiveNow = active.get(existing.userId) ?? existing.isActive;
      const wantsActive = statusText === "active";

      if (role && role !== currentRole) {
        set.role = role;
        changes.push(`role ${currentRole} → ${role}`);
      }
      if (!wantsActive && isActiveNow) {
        if (existing.userId === actorId) fail("status", "You cannot deactivate yourself.");
        set.isActive = false;
        set.deactivatedAt = new Date();
        changes.push("deactivate");
      } else if (wantsActive && !isActiveNow) {
        set.isActive = true;
        set.deactivatedAt = null;
        changes.push("reactivate");
      }
      const adminBefore = isActiveNow && currentRole === "admin" ? 1 : 0;
      const adminAfter = (set.isActive ?? isActiveNow) && (set.role ?? currentRole) === "admin" ? 1 : 0;
      const adminDelta = adminAfter - adminBefore;
      if (activeAdmins + adminDelta < 1) {
        fail(set.isActive === false ? "status" : "role", "Keep at least one active admin in the workspace.");
      }
      if (managerId && managerId !== managers.get(existing.userId)) {
        if (createsReportingLoop(managers, existing.userId, managerId)) {
          fail("manager_email", `Reporting loop: ${managerEmail} already reports (directly or indirectly) to ${email}.`);
        }
        set.managerId = managerId;
        changes.push(`manager → ${managerEmail}`);
      }
      if (jobTitle && jobTitle !== existing.jobTitle) {
        set.jobTitle = jobTitle;
        changes.push(`job title → ${jobTitle}`);
      }
      if (teamKey) {
        const team = teamsByKey.get(teamKey);
        if (!team || !linkedTeams.has(`${team.id}:${existing.userId}`)) changes.push(`add to team ${team?.name ?? teamName}`);
      }

      if (!rowErrors.length) {
        if (set.managerId) managers.set(existing.userId, set.managerId);
        if (set.role) roles.set(existing.userId, set.role);
        if (set.isActive !== undefined) active.set(existing.userId, set.isActive);
        activeAdmins += adminDelta;
        if (teamKey && !teamsByKey.has(teamKey)) teamsToCreate.set(teamKey, teamName);
        if (changes.length) {
          plans.push({ kind: "update", row, email, membershipId: existing.membershipId, userId: existing.userId, set, teamKey, changes });
        }
        preview.push({ row, email, action: changes.length ? "update" : "unchanged", changes });
      }
    } else if (!rowErrors.length) {
      if (statusText === "inactive") fail("status", "New people can only be invited as active.");
      else if (pendingEmails.has(email)) fail("email", `${email} already has a pending invitation.`);
      else {
        if (teamKey && !teamsByKey.has(teamKey)) teamsToCreate.set(teamKey, teamName);
        changes.push(`invite as ${role ?? "member"}`);
        if (teamKey) changes.push(`team ${teamsByKey.get(teamKey)?.name ?? teamName}`);
        if (managerId) changes.push(`manager ${managerEmail}`);
        pendingEmails.add(email);
        plans.push({ kind: "invite", row, email, name, role: role ?? "member", managerId, jobTitle, teamKey, changes });
        preview.push({ row, email, action: "invite", changes });
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      preview.push({ row, email, action: "error", changes: rowErrors.map((error) => error.message) });
    }
  }

  const summary = {
    created: teamsToCreate.size,
    updated: plans.filter((plan) => plan.kind === "update").length,
    invited: plans.filter((plan) => plan.kind === "invite").length,
    errors,
  };
  if (dryRun) return NextResponse.json({ ...summary, dryRun: true, rows: preview.sort((a, b) => a.row - b.row) });

  const createdInvitations = await database.transaction(async (transaction) => {
    const teamIds = new Map([...teamsByKey].map(([key, team]) => [key, team.id]));
    if (teamsToCreate.size) {
      await transaction.insert(teams).values([...teamsToCreate.values()].map((name) => ({ companyId, name })))
        .onConflictDoNothing();
      const fresh = await transaction.select({ id: teams.id, name: teams.name }).from(teams).where(and(
        eq(teams.companyId, companyId),
        inArray(teams.name, [...teamsToCreate.values()]),
      ));
      for (const team of fresh) teamIds.set(team.name.toLowerCase(), team.id);
    }

    const now = new Date();
    const inserted: { id: string; email: string; token: string }[] = [];
    for (const plan of plans) {
      const teamId = plan.teamKey ? teamIds.get(plan.teamKey) ?? null : null;
      if (plan.kind === "update") {
        if (Object.keys(plan.set).length) {
          await transaction.update(companyMemberships).set({ ...plan.set, updatedAt: now }).where(and(
            eq(companyMemberships.id, plan.membershipId),
            eq(companyMemberships.companyId, companyId),
          ));
        }
        if (teamId) {
          await transaction.insert(teamMemberships).values({ companyId, teamId, userId: plan.userId }).onConflictDoNothing();
        }
      } else {
        const [invitation] = await transaction.insert(invitations).values({
          companyId,
          email: plan.email,
          name: plan.name,
          role: plan.role,
          teamId,
          managerId: plan.managerId,
          jobTitle: plan.jobTitle,
          token: createInvitationToken(),
          invitedBy: actorId,
          expiresAt: invitationExpiry(),
        }).returning({ id: invitations.id, email: invitations.email, token: invitations.token });
        inserted.push(invitation);
      }
    }

    await recordAudit(transaction, {
      companyId,
      actorId,
      action: "employees_imported",
      entityType: "import",
      entityId: randomUUID(),
      reason: `Staff CSV import: ${summary.updated} updated, ${summary.invited} invited, ${summary.created} teams created, ${errors.length} errors`,
      details: {
        rowCount: rows.length,
        created: summary.created,
        updated: summary.updated,
        invited: summary.invited,
        errorCount: errors.length,
        updatedEmails: plans.filter((plan) => plan.kind === "update").map((plan) => plan.email).slice(0, 200),
        invitedEmails: inserted.map((invitation) => invitation.email).slice(0, 200),
      },
    });
    return inserted;
  });

  for (const invitation of createdInvitations) {
    await deliverInvitation(request, invitation, context.companyName, context.session.user.name);
  }

  return NextResponse.json({ ...summary, dryRun: false, rows: preview.sort((a, b) => a.row - b.row) });
}
