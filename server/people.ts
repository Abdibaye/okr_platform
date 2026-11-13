import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { auditLogs, companyMemberships, invitations, teamMemberships, teams } from "./schema";

export type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Executor = ReturnType<typeof getDb> | Transaction;

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ROLES = ["admin", "manager", "member"] as const;
export type MembershipRole = (typeof ROLES)[number];

export function isRole(value: unknown): value is MembershipRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export function invitationExpiry(from = Date.now()) {
  return new Date(from + INVITATION_TTL_MS);
}

export function inviteUrl(request: Request, token: string) {
  const base = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  return new URL(`/invite?token=${encodeURIComponent(token)}`, base).toString();
}

/** True when making `managerId` the manager of `userId` would create a cycle (or a self-manager). */
export function createsReportingLoop(managers: Map<string, string | null>, userId: string, managerId: string) {
  const seen = new Set<string>();
  let current: string | null | undefined = managerId;
  while (current) {
    if (current === userId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = managers.get(current);
  }
  return false;
}

export async function loadManagerMap(executor: Executor, companyId: string) {
  const rows = await executor.select({ userId: companyMemberships.userId, managerId: companyMemberships.managerId })
    .from(companyMemberships)
    .where(eq(companyMemberships.companyId, companyId));
  return new Map(rows.map((row) => [row.userId, row.managerId]));
}

/** Counts active admins, locking their rows so concurrent demotions cannot remove the last one. */
export async function countActiveAdmins(transaction: Transaction, companyId: string) {
  const rows = await transaction.select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.role, "admin"),
      eq(companyMemberships.isActive, true),
    ))
    .for("update");
  return rows.length;
}

export async function recordAudit(executor: Executor, entry: {
  companyId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  details?: Record<string, unknown>;
}) {
  await executor.insert(auditLogs).values({ ...entry, details: entry.details ?? {} });
}

/** Joins `userId` to the invitation's company with its role/team/manager and marks it accepted. */
export async function acceptInvitation(transaction: Transaction, invitation: typeof invitations.$inferSelect, userId: string) {
  const managers = await loadManagerMap(transaction, invitation.companyId);
  let managerId = invitation.managerId;
  if (managerId && (!managers.has(managerId) || createsReportingLoop(managers, userId, managerId))) managerId = null;

  const now = new Date();
  await transaction.insert(companyMemberships).values({
    companyId: invitation.companyId,
    userId,
    role: invitation.role,
    managerId,
    jobTitle: invitation.jobTitle,
  }).onConflictDoUpdate({
    target: [companyMemberships.companyId, companyMemberships.userId],
    set: {
      role: invitation.role,
      managerId,
      ...(invitation.jobTitle ? { jobTitle: invitation.jobTitle } : {}),
      isActive: true,
      deactivatedAt: null,
      updatedAt: now,
    },
  });

  if (invitation.teamId) {
    const [team] = await transaction.select({ id: teams.id }).from(teams).where(and(
      eq(teams.id, invitation.teamId),
      eq(teams.companyId, invitation.companyId),
      isNull(teams.archivedAt),
    )).limit(1);
    if (team) {
      await transaction.insert(teamMemberships).values({
        companyId: invitation.companyId,
        teamId: team.id,
        userId,
      }).onConflictDoNothing();
    }
  }

  await transaction.update(invitations).set({
    status: "accepted",
    acceptedBy: userId,
    acceptedAt: now,
  }).where(eq(invitations.id, invitation.id));

  await recordAudit(transaction, {
    companyId: invitation.companyId,
    actorId: userId,
    action: "invitation_accepted",
    entityType: "invitation",
    entityId: invitation.id,
    reason: `Invitation accepted by ${invitation.email}`,
    details: { role: invitation.role, teamId: invitation.teamId, managerId },
  });
}
