#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";
import { hashPassword } from "better-auth/crypto";

const filePathArg = process.argv[2] || "docs/recovery/workspace-recovery.json";
const resolvedPath = path.resolve(filePathArg);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: Recovery file not found at ${resolvedPath}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is required.");
  console.error("Usage: node --env-file=.env.local scripts/restore-backup.mjs [path-to-backup.json]");
  process.exit(1);
}

const rawData = fs.readFileSync(resolvedPath, "utf8");
let backup;
try {
  backup = JSON.parse(rawData);
} catch (err) {
  console.error(`Error: Failed to parse JSON in ${resolvedPath}:`, err.message);
  process.exit(1);
}

console.log(`=======================================================`);
console.log(` Alineo Backup Restore Tool`);
console.log(` Target File: ${resolvedPath}`);
console.log(` Export Timestamp: ${backup.exportedAt || "N/A"}`);
console.log(` Company: ${backup.company?.name || "Unknown"} (${backup.company?.id || "N/A"})`);
console.log(`=======================================================\n`);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
});

await client.connect();

// Helper to generate a high-entropy temporary password
function generateSecurePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*";
  const bytes = crypto.randomBytes(16);
  let pass = "";
  for (let i = 0; i < 16; i++) {
    pass += chars[bytes[i] % chars.length];
  }
  return pass + "Aa1!";
}

const credentialsManifest = [];

try {
  await client.query("BEGIN");

  // 1. Restore Company
  if (backup.company && backup.company.id) {
    const comp = backup.company;
    await client.query(
      `INSERT INTO companies (id, name, created_at)
       VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name`,
      [comp.id, comp.name, comp.createdAt || null]
    );
    console.log(`✓ Restored Company: ${comp.name} (${comp.id})`);
  }

  // Determine arrays depending on backup format (rich format vs legacy live format)
  const rawUsers = backup.users || [];
  const rawStaff = backup.staff || (backup.memberships && !backup.memberships[0]?.teamId ? backup.memberships : []);
  const rawMemberships = backup.companyMemberships || [];
  const rawTeamMemberships = backup.teamMemberships || (backup.memberships && backup.memberships[0]?.teamId ? backup.memberships : []);

  // Consolidate known user profiles
  const userMap = new Map();
  for (const u of rawUsers) {
    if (u.id) userMap.set(u.id, { id: u.id, name: u.name || "", email: u.email || "", image: u.image || null });
  }
  for (const s of rawStaff) {
    const uid = s.userId || s.id;
    if (uid) {
      const existing = userMap.get(uid);
      userMap.set(uid, {
        id: uid,
        name: s.name || existing?.name || "",
        email: s.email || existing?.email || "",
        image: s.image || existing?.image || null,
      });
    }
  }

  // Collect ALL user IDs referenced across all backup entities to prevent foreign key violations
  const referencedUserIds = new Set();
  function addUserId(uid) {
    if (uid && typeof uid === "string" && uid.trim().length > 0) {
      referencedUserIds.add(uid.trim());
    }
  }

  for (const u of rawUsers) addUserId(u.id);
  for (const s of rawStaff) addUserId(s.userId || s.id);
  for (const m of rawMemberships) addUserId(m.userId);
  for (const tm of rawTeamMemberships) addUserId(tm.userId);
  for (const t of backup.teams || []) addUserId(t.leadUserId);
  for (const c of backup.cycles || []) addUserId(c.createdBy);
  for (const o of backup.objectives || []) {
    addUserId(o.ownerId);
    addUserId(o.createdBy);
    addUserId(o.approvedBy);
  }
  for (const kr of backup.keyResults || []) addUserId(kr.ownerId);
  for (const ci of backup.checkIns || []) addUserId(ci.authorId);
  for (const cm of backup.comments || []) addUserId(cm.authorId);
  for (const al of backup.auditLogs || []) addUserId(al.actorId);
  for (const oa of backup.objectiveAccess || []) addUserId(oa.userId);
  for (const kre of backup.keyResultEditors || []) addUserId(kre.userId);
  for (const inv of backup.invitations || []) {
    addUserId(inv.invitedBy);
    addUserId(inv.acceptedBy);
    addUserId(inv.managerId);
  }
  for (const notif of backup.notifications || []) {
    addUserId(notif.recipientId);
    addUserId(notif.actorId);
  }

  // 2. Restore Users & Auth Credentials (Ensuring every referenced user exists)
  let usersRestored = 0;
  for (const uid of referencedUserIds) {
    const profile = userMap.get(uid);
    let name = profile?.name;
    let email = profile?.email;
    let image = profile?.image || null;

    // Check if user already exists in database
    const existing = await client.query(`SELECT id, name, email, image FROM "user" WHERE id = $1`, [uid]);
    if (existing.rowCount > 0) {
      name = name || existing.rows[0].name;
      email = email || existing.rows[0].email;
      image = image || existing.rows[0].image;
    }

    // If email is still missing, synthesize a valid unique email
    if (!email || email.trim() === "") {
      const cleanUid = uid.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
      email = `user-${cleanUid}@recovery.local`;
      name = name || `Staff Member (${uid.slice(0, 8)})`;
    }

    // Guard against unique constraint violation on email if another user has this exact email
    const emailConflict = await client.query(
      `SELECT id FROM "user" WHERE email = $1 AND id <> $2`,
      [email, uid]
    );
    if (emailConflict.rowCount > 0) {
      email = `user-${uid.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)}-${Date.now()}@recovery.local`;
    }

    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, image, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), "user".name),
         email = COALESCE(NULLIF(EXCLUDED.email, ''), "user".email),
         image = COALESCE(EXCLUDED.image, "user".image),
         updated_at = NOW()`,
      [uid, name || "Staff User", email, image]
    );

    // Determine temporary password & credential provisioning
    const userTempPassword = process.env.RECOVERY_PASSWORD || generateSecurePassword();
    const userPasswordHash = await hashPassword(userTempPassword);

    // Ensure account record exists for credential logins, and update password on repeat restore so credentials always work
    const existingAccount = await client.query(
      `SELECT id FROM account WHERE user_id = $1 AND provider_id = 'credential'`,
      [uid]
    );
    if (existingAccount.rowCount === 0) {
      await client.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, 'credential', $1, $2, NOW(), NOW())`,
        [uid, userPasswordHash]
      );
    } else {
      await client.query(
        `UPDATE account
         SET password = $1, updated_at = NOW()
         WHERE user_id = $2 AND provider_id = 'credential'`,
        [userPasswordHash, uid]
      );
    }

    // Provision secure one-time password reset verification token (24-hour expiration)
    // Better Auth resetPassword endpoint verifies: identifier = 'reset-password:' || token, and reads value as userId
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Clear prior reset tokens for this user to ensure clean state
    await client.query(
      `DELETE FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%'`,
      [uid]
    );

    await client.query(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())`,
      [`reset-password:${resetToken}`, uid, tokenExpiresAt]
    );

    credentialsManifest.push({
      userId: uid,
      name: name || "Staff User",
      email,
      temporaryPassword: userTempPassword,
      resetToken,
      resetUrl: `/reset-password?token=${resetToken}`,
      tokenExpiresAt: tokenExpiresAt.toISOString(),
      accountUpdated: existingAccount.rowCount > 0,
    });

    usersRestored++;
  }
  console.log(`✓ Restored ${usersRestored} User identities & auth credentials (secure credentials generated)`);

  // Consolidate Company Memberships
  const membershipMap = new Map();
  for (const m of rawMemberships) {
    if (m.userId) {
      membershipMap.set(m.userId, {
        id: m.id || null,
        companyId: m.companyId || backup.company?.id,
        userId: m.userId,
        role: m.role || "member",
        managerId: m.managerId || null,
        jobTitle: m.jobTitle || "",
        isActive: m.isActive !== undefined ? m.isActive : true,
        deactivatedAt: m.deactivatedAt || null,
        createdAt: m.createdAt || null,
        updatedAt: m.updatedAt || null,
      });
    }
  }
  for (const s of rawStaff) {
    const uid = s.userId || s.id;
    if (uid) {
      const existing = membershipMap.get(uid) || {};
      membershipMap.set(uid, {
        id: existing.id || s.id || null,
        companyId: existing.companyId || s.companyId || backup.company?.id,
        userId: uid,
        role: s.role || existing.role || "member",
        managerId: s.managerId !== undefined ? s.managerId : (existing.managerId || null),
        jobTitle: s.jobTitle || existing.jobTitle || "",
        isActive: s.isActive !== undefined ? s.isActive : (existing.isActive !== undefined ? existing.isActive : true),
        deactivatedAt: s.deactivatedAt || existing.deactivatedAt || null,
        createdAt: s.createdAt || existing.createdAt || null,
        updatedAt: s.updatedAt || existing.updatedAt || null,
      });
    }
  }

  // Ensure every referenced user has a company membership
  if (backup.company?.id) {
    let hasAdmin = Array.from(membershipMap.values()).some((m) => m.role === "admin");
    for (const uid of referencedUserIds) {
      if (!membershipMap.has(uid)) {
        membershipMap.set(uid, {
          id: crypto.randomUUID(),
          companyId: backup.company.id,
          userId: uid,
          role: !hasAdmin ? "admin" : "member",
          managerId: null,
          jobTitle: "",
          isActive: true,
          deactivatedAt: null,
          createdAt: null,
          updatedAt: null,
        });
        if (!hasAdmin) hasAdmin = true;
      }
    }
  }

  // 3. Restore Company Memberships (Pass 1 - Unlinked hierarchy to satisfy foreign keys)
  let membershipsRestored = 0;
  for (const m of membershipMap.values()) {
    if (!m.companyId || !m.userId) continue;
    await client.query(
      `INSERT INTO company_memberships (
         id, company_id, user_id, role, manager_id, job_title, is_active, deactivated_at, created_at, updated_at
       )
       VALUES (
         COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, NULL, $5, $6, $7,
         COALESCE($8::timestamptz, NOW()), COALESCE($9::timestamptz, NOW())
       )
       ON CONFLICT (company_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         job_title = EXCLUDED.job_title,
         is_active = EXCLUDED.is_active,
         deactivated_at = EXCLUDED.deactivated_at,
         updated_at = COALESCE(EXCLUDED.updated_at, company_memberships.updated_at)`,
      [m.id, m.companyId, m.userId, m.role, m.jobTitle, m.isActive, m.deactivatedAt, m.createdAt, m.updatedAt]
    );
    membershipsRestored++;
  }
  console.log(`✓ Restored ${membershipsRestored} Company Memberships (Pass 1: base roles & profiles)`);

  // 4. Restore Manager Reporting Lines (Pass 2 - Hierarchy linking)
  let managerLinesLinked = 0;
  for (const m of membershipMap.values()) {
    if (m.managerId) {
      const mgrExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [m.managerId]);
      if (mgrExists.rowCount > 0 && m.managerId !== m.userId) {
        await client.query(
          `UPDATE company_memberships
           SET manager_id = $1, updated_at = COALESCE($2::timestamptz, updated_at)
           WHERE company_id = $3 AND user_id = $4`,
          [m.managerId, m.updatedAt || null, m.companyId, m.userId]
        );
        managerLinesLinked++;
      } else {
        console.warn(`  ! Manager ID ${m.managerId} skipped for user ${m.userId} (not found or self-reference)`);
      }
    }
  }
  console.log(`✓ Linked ${managerLinesLinked} Managerial Reporting Lines (Pass 2: hierarchy trees verified)`);

  // 5. Restore Teams
  const teams = backup.teams || [];
  let teamsRestored = 0;
  for (const t of teams) {
    if (!t.id || !t.companyId || !t.name) continue;

    // Validate lead_user_id
    let leadId = t.leadUserId || null;
    if (leadId) {
      const exists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [leadId]);
      if (exists.rowCount === 0) leadId = null;
    }

    await client.query(
      `INSERT INTO teams (id, company_id, name, description, lead_user_id, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         lead_user_id = EXCLUDED.lead_user_id,
         archived_at = EXCLUDED.archived_at,
         updated_at = COALESCE(EXCLUDED.updated_at, teams.updated_at)`,
      [t.id, t.companyId, t.name, t.description || "", leadId, t.archivedAt || null, t.createdAt || null, t.updatedAt || null]
    );
    teamsRestored++;
  }
  console.log(`✓ Restored ${teamsRestored} Teams`);

  // 6. Restore Team Memberships
  let teamMembershipsRestored = 0;
  for (const tm of rawTeamMemberships) {
    if (!tm.teamId || !tm.userId || !tm.companyId) continue;

    const teamExists = await client.query(`SELECT id FROM teams WHERE id = $1`, [tm.teamId]);
    const userExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [tm.userId]);
    if (teamExists.rowCount === 0 || userExists.rowCount === 0) continue;

    await client.query(
      `INSERT INTO team_memberships (id, company_id, team_id, user_id, is_lead, created_at)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
       ON CONFLICT (team_id, user_id) DO UPDATE SET
         is_lead = EXCLUDED.is_lead`,
      [tm.id || null, tm.companyId, tm.teamId, tm.userId, tm.isLead || false, tm.createdAt || null]
    );
    teamMembershipsRestored++;
  }
  console.log(`✓ Restored ${teamMembershipsRestored} Team Memberships`);

  // 7. Restore OKR Cycles
  const cycles = backup.cycles || [];
  let cyclesRestored = 0;
  for (const c of cycles) {
    if (!c.id || !c.companyId || !c.name) continue;
    await client.query(
      `INSERT INTO okr_cycles (
         id, company_id, name, start_date, end_date, status, final_reflection,
         require_approval, check_in_cadence, archived_at, version, created_by, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW()), COALESCE($14::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         status = EXCLUDED.status,
         final_reflection = EXCLUDED.final_reflection,
         require_approval = EXCLUDED.require_approval,
         check_in_cadence = EXCLUDED.check_in_cadence,
         archived_at = EXCLUDED.archived_at,
         version = EXCLUDED.version,
         updated_at = COALESCE(EXCLUDED.updated_at, okr_cycles.updated_at)`,
      [
        c.id, c.companyId, c.name, c.startDate, c.endDate, c.status || "open",
        c.finalReflection || "", c.requireApproval || false, c.checkInCadence || "weekly",
        c.archivedAt || null, c.version || 1, c.createdBy, c.createdAt || null, c.updatedAt || null
      ]
    );
    cyclesRestored++;
  }
  console.log(`✓ Restored ${cyclesRestored} OKR Planning Cycles`);

  // 8. Restore Objectives (Pass 1: base objectives; Pass 2: parent alignment & copied goals)
  const objectives = backup.objectives || [];
  let objectivesRestored = 0;
  for (const obj of objectives) {
    if (!obj.id || !obj.companyId || !obj.cycleId || !obj.title) continue;

    let ownerId = obj.ownerId || null;
    if (ownerId) {
      const exists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [ownerId]);
      if (exists.rowCount === 0) ownerId = null;
    }

    let teamId = obj.teamId || null;
    if (teamId) {
      const exists = await client.query(`SELECT id FROM teams WHERE id = $1`, [teamId]);
      if (exists.rowCount === 0) teamId = null;
    }

    // Preserve exact progress value: keep null as null, do not coerce to "0"
    const progressVal = (obj.progress !== null && obj.progress !== undefined) ? obj.progress : null;

    // Both parent_objective_id and copied_from_objective_id are set to NULL in Pass 1
    // to prevent foreign key violations regardless of objective ordering in the JSON payload.
    await client.query(
      `INSERT INTO objectives (
         id, company_id, cycle_id, title, description, progress, level, team_id,
         owner_id, due_date, status, approval_status, approved_by, approved_at,
         visibility, parent_objective_id, copied_from_objective_id, archived_at,
         version, created_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14,
         $15, NULL, NULL, $16,
         $17, $18, COALESCE($19::timestamptz, NOW()), COALESCE($20::timestamptz, NOW())
       )
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         progress = EXCLUDED.progress,
         level = EXCLUDED.level,
         team_id = EXCLUDED.team_id,
         owner_id = EXCLUDED.owner_id,
         due_date = EXCLUDED.due_date,
         status = EXCLUDED.status,
         approval_status = EXCLUDED.approval_status,
         approved_by = EXCLUDED.approved_by,
         approved_at = EXCLUDED.approved_at,
         visibility = EXCLUDED.visibility,
         archived_at = EXCLUDED.archived_at,
         version = EXCLUDED.version,
         updated_at = COALESCE(EXCLUDED.updated_at, objectives.updated_at)`,
      [
        obj.id, obj.companyId, obj.cycleId, obj.title, obj.description || "",
        progressVal, obj.level || "company", teamId,
        ownerId, obj.dueDate || null, obj.status || "active",
        obj.approvalStatus || "approved", obj.approvedBy || null, obj.approvedAt || null,
        obj.visibility || "company",
        obj.archivedAt || null, obj.version || 1, obj.createdBy,
        obj.createdAt || null, obj.updatedAt || null
      ]
    );
    objectivesRestored++;
  }

  // Pass 2: Parent objective linking & Copied objective references
  let parentAlignmentsLinked = 0;
  let copiedGoalsLinked = 0;
  for (const obj of objectives) {
    let parentId = null;
    if (obj.parentObjectiveId && obj.parentObjectiveId !== obj.id) {
      const parentExists = await client.query(`SELECT id FROM objectives WHERE id = $1`, [obj.parentObjectiveId]);
      if (parentExists.rowCount > 0) {
        parentId = obj.parentObjectiveId;
        parentAlignmentsLinked++;
      }
    }

    let copiedFromId = null;
    if (obj.copiedFromObjectiveId && obj.copiedFromObjectiveId !== obj.id) {
      const copiedExists = await client.query(`SELECT id FROM objectives WHERE id = $1`, [obj.copiedFromObjectiveId]);
      if (copiedExists.rowCount > 0) {
        copiedFromId = obj.copiedFromObjectiveId;
        copiedGoalsLinked++;
      }
    }

    if (parentId !== null || copiedFromId !== null) {
      await client.query(
        `UPDATE objectives
         SET
           parent_objective_id = COALESCE($1::uuid, parent_objective_id),
           copied_from_objective_id = COALESCE($2::uuid, copied_from_objective_id),
           updated_at = COALESCE($3::timestamptz, updated_at)
         WHERE id = $4`,
        [parentId, copiedFromId, obj.updatedAt || null, obj.id]
      );
    }
  }
  console.log(`✓ Restored ${objectivesRestored} Objectives (${parentAlignmentsLinked} parent alignments, ${copiedGoalsLinked} copied references linked)`);

  // 9. Restore Objective Access Permissions
  const objectiveAccess = backup.objectiveAccess || [];
  let objectiveAccessRestored = 0;
  for (const oa of objectiveAccess) {
    if (!oa.companyId || !oa.objectiveId || !oa.userId) continue;

    const objExists = await client.query(`SELECT id FROM objectives WHERE id = $1`, [oa.objectiveId]);
    const userExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [oa.userId]);
    if (objExists.rowCount === 0 || userExists.rowCount === 0) continue;

    await client.query(
      `INSERT INTO objective_access (id, company_id, objective_id, user_id, permission)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
       ON CONFLICT (objective_id, user_id) DO UPDATE SET
         permission = EXCLUDED.permission`,
      [oa.id || null, oa.companyId, oa.objectiveId, oa.userId, oa.permission || "viewer"]
    );
    objectiveAccessRestored++;
  }
  console.log(`✓ Restored ${objectiveAccessRestored} Goal Permissions (objective_access)`);

  // 10. Restore Key Results
  const keyResults = backup.keyResults || [];
  let keyResultsRestored = 0;
  for (const kr of keyResults) {
    if (!kr.id || !kr.companyId || !kr.objectiveId || !kr.title) continue;

    const objExists = await client.query(`SELECT id FROM objectives WHERE id = $1`, [kr.objectiveId]);
    if (objExists.rowCount === 0) continue;

    let ownerId = kr.ownerId || null;
    if (ownerId) {
      const exists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [ownerId]);
      if (exists.rowCount === 0) ownerId = null;
    }

    const krProgressVal = (kr.progress !== null && kr.progress !== undefined) ? kr.progress : "0";

    await client.query(
      `INSERT INTO key_results (
         id, company_id, objective_id, title, metric_type, direction, unit,
         baseline, target, current, progress, owner_id, due_date, confidence,
         last_check_in_at, last_effective_date, archived_at, version, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, COALESCE($19::timestamptz, NOW()), COALESCE($20::timestamptz, NOW())
       )
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         metric_type = EXCLUDED.metric_type,
         direction = EXCLUDED.direction,
         unit = EXCLUDED.unit,
         baseline = EXCLUDED.baseline,
         target = EXCLUDED.target,
         current = EXCLUDED.current,
         progress = EXCLUDED.progress,
         owner_id = EXCLUDED.owner_id,
         due_date = EXCLUDED.due_date,
         confidence = EXCLUDED.confidence,
         last_check_in_at = EXCLUDED.last_check_in_at,
         last_effective_date = EXCLUDED.last_effective_date,
         archived_at = EXCLUDED.archived_at,
         version = EXCLUDED.version,
         updated_at = COALESCE(EXCLUDED.updated_at, key_results.updated_at)`,
      [
        kr.id, kr.companyId, kr.objectiveId, kr.title, kr.metricType || "numeric",
        kr.direction || "increasing", kr.unit || "", kr.baseline || "0", kr.target || "100",
        kr.current || "0", krProgressVal, ownerId, kr.dueDate || null,
        kr.confidence || "on_track", kr.lastCheckInAt || null, kr.lastEffectiveDate || null,
        kr.archivedAt || null, kr.version || 1, kr.createdAt || null, kr.updatedAt || null
      ]
    );
    keyResultsRestored++;
  }
  console.log(`✓ Restored ${keyResultsRestored} Key Results`);

  // 11. Restore Key Result Editors
  const keyResultEditors = backup.keyResultEditors || [];
  let keyResultEditorsRestored = 0;
  for (const kre of keyResultEditors) {
    if (!kre.companyId || !kre.keyResultId || !kre.userId) continue;

    const krExists = await client.query(`SELECT id FROM key_results WHERE id = $1`, [kre.keyResultId]);
    const userExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [kre.userId]);
    if (krExists.rowCount === 0 || userExists.rowCount === 0) continue;

    await client.query(
      `INSERT INTO key_result_editors (id, company_id, key_result_id, user_id)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4)
       ON CONFLICT (key_result_id, user_id) DO NOTHING`,
      [kre.id || null, kre.companyId, kre.keyResultId, kre.userId]
    );
    keyResultEditorsRestored++;
  }
  console.log(`✓ Restored ${keyResultEditorsRestored} Goal Editors (key_result_editors)`);

  // 12. Restore KR Check-Ins
  const checkIns = backup.checkIns || [];
  let checkInsRestored = 0;
  for (const ci of checkIns) {
    if (!ci.id || !ci.companyId || !ci.keyResultId) continue;

    const krExists = await client.query(`SELECT id FROM key_results WHERE id = $1`, [ci.keyResultId]);
    if (krExists.rowCount === 0) continue;

    await client.query(
      `INSERT INTO kr_check_ins (
         id, company_id, cycle_id, objective_id, key_result_id, author_id,
         effective_date, value, progress, confidence, note, blockers,
         corrects_check_in_id, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, COALESCE($14::timestamptz, NOW())
       )
       ON CONFLICT (id) DO UPDATE SET
         value = EXCLUDED.value,
         progress = EXCLUDED.progress,
         confidence = EXCLUDED.confidence,
         note = EXCLUDED.note,
         blockers = EXCLUDED.blockers`,
      [
        ci.id, ci.companyId, ci.cycleId, ci.objectiveId, ci.keyResultId, ci.authorId,
        ci.effectiveDate, ci.value, ci.progress, ci.confidence || "on_track",
        ci.note || "", ci.blockers || "", ci.correctsCheckInId || null, ci.createdAt || null
      ]
    );
    checkInsRestored++;
  }
  console.log(`✓ Restored ${checkInsRestored} KR Check-in History records`);

  // 13. Restore Comments
  const comments = backup.comments || [];
  let commentsRestored = 0;
  for (const cm of comments) {
    if (!cm.id || !cm.companyId || !cm.objectiveId) continue;

    const objExists = await client.query(`SELECT id FROM objectives WHERE id = $1`, [cm.objectiveId]);
    if (objExists.rowCount === 0) continue;

    await client.query(
      `INSERT INTO goal_comments (
         id, company_id, objective_id, key_result_id, author_id, body, mentions, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         body = EXCLUDED.body,
         mentions = EXCLUDED.mentions`,
      [
        cm.id, cm.companyId, cm.objectiveId, cm.keyResultId || null, cm.authorId,
        cm.body || cm.content || "", JSON.stringify(cm.mentions || []), cm.createdAt || null
      ]
    );
    commentsRestored++;
  }
  console.log(`✓ Restored ${commentsRestored} Goal Comments`);

  // 14. Restore Invitations
  const invitations = backup.invitations || [];
  let invitationsRestored = 0;
  for (const inv of invitations) {
    if (!inv.id || !inv.companyId || !inv.email || !inv.token) continue;

    let teamId = inv.teamId || null;
    if (teamId) {
      const teamExists = await client.query(`SELECT id FROM teams WHERE id = $1`, [teamId]);
      if (teamExists.rowCount === 0) teamId = null;
    }

    let managerId = inv.managerId || null;
    if (managerId) {
      const mgrExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [managerId]);
      if (mgrExists.rowCount === 0) managerId = null;
    }

    let acceptedBy = inv.acceptedBy || null;
    if (acceptedBy) {
      const userExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [acceptedBy]);
      if (userExists.rowCount === 0) acceptedBy = null;
    }

    await client.query(
      `INSERT INTO invitations (
         id, company_id, email, name, role, team_id, manager_id, job_title,
         token, status, invited_by, accepted_by, expires_at, accepted_at,
         email_delivery_status, email_error, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13::timestamptz, $14::timestamptz,
         $15, $16, COALESCE($17::timestamptz, NOW())
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         accepted_by = EXCLUDED.accepted_by,
         accepted_at = EXCLUDED.accepted_at,
         email_delivery_status = EXCLUDED.email_delivery_status,
         email_error = EXCLUDED.email_error`,
      [
        inv.id, inv.companyId, inv.email, inv.name || "", inv.role || "member",
        teamId, managerId, inv.jobTitle || "", inv.token, inv.status || "pending",
        inv.invitedBy, acceptedBy, inv.expiresAt, inv.acceptedAt || null,
        inv.emailDeliveryStatus || "pending", inv.emailError || null, inv.createdAt || null
      ]
    );
    invitationsRestored++;
  }
  console.log(`✓ Restored ${invitationsRestored} Invitations`);

  // 15. Restore Notifications
  const notifications = backup.notifications || [];
  let notificationsRestored = 0;
  for (const n of notifications) {
    if (!n.id || !n.companyId || !n.recipientId || !n.dedupKey) continue;

    const userExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [n.recipientId]);
    if (userExists.rowCount === 0) continue;

    let actorId = n.actorId || null;
    if (actorId) {
      const actorExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [actorId]);
      if (actorExists.rowCount === 0) actorId = null;
    }

    await client.query(
      `INSERT INTO notifications (
         id, company_id, recipient_id, actor_id, type, title, body,
         link_path, entity_type, entity_id, dedup_key, read_at,
         email_status, email_attempts, email_error, last_attempt_at, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12::timestamptz,
         $13, $14, $15, $16::timestamptz, COALESCE($17::timestamptz, NOW())
       )
       ON CONFLICT (company_id, recipient_id, dedup_key) DO UPDATE SET
         read_at = EXCLUDED.read_at,
         email_status = EXCLUDED.email_status,
         email_attempts = EXCLUDED.email_attempts,
         email_error = EXCLUDED.email_error,
         last_attempt_at = EXCLUDED.last_attempt_at`,
      [
        n.id, n.companyId, n.recipientId, actorId, n.type || "system", n.title, n.body || "",
        n.linkPath || null, n.entityType || null, n.entityId || null, n.dedupKey, n.readAt || null,
        n.emailStatus || "in_app_only", n.emailAttempts || 0, n.emailError || null,
        n.lastAttemptAt || null, n.createdAt || null
      ]
    );
    notificationsRestored++;
  }
  console.log(`✓ Restored ${notificationsRestored} Notifications`);

  // 16. Restore Audit Logs
  const auditLogs = backup.auditLogs || [];
  let auditLogsRestored = 0;
  for (const al of auditLogs) {
    if (!al.id || !al.companyId || !al.action) continue;
    await client.query(
      `INSERT INTO audit_logs (
         id, company_id, cycle_id, actor_id, action, entity_type, entity_id, reason, details, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, COALESCE($10::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         action = EXCLUDED.action,
         reason = EXCLUDED.reason,
         details = EXCLUDED.details`,
      [
        al.id, al.companyId, al.cycleId || null, al.actorId, al.action,
        al.entityType || null, al.entityId || null, al.reason || "",
        JSON.stringify(al.details || {}), al.createdAt || null
      ]
    );
    auditLogsRestored++;
  }
  console.log(`✓ Restored ${auditLogsRestored} Audit Trail entries`);

  await client.query("COMMIT");

  // Save generated secure credentials manifest to a protected local file
  const credsDir = path.resolve("docs/recovery");
  if (!fs.existsSync(credsDir)) {
    fs.mkdirSync(credsDir, { recursive: true, mode: 0o700 });
  } else {
    try { fs.chmodSync(credsDir, 0o700); } catch {}
  }
  const credsPath = path.join(credsDir, "recovery-credentials.json");
  fs.writeFileSync(
    credsPath,
    JSON.stringify(
      {
        restoredAt: new Date().toISOString(),
        company: backup.company?.name,
        credentials: credentialsManifest.map((c) => ({
          userId: c.userId,
          name: c.name,
          email: c.email,
          temporaryPassword: c.temporaryPassword,
          resetToken: c.resetToken,
          resetUrl: c.resetUrl,
          tokenExpiresAt: c.tokenExpiresAt,
        })),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  // Explicitly enforce 0600 permissions even when overwriting an existing file
  fs.chmodSync(credsPath, 0o600);

  console.log(`\n=======================================================`);
  console.log(` RESTORE COMPLETED SUCCESSFULLY!`);
  console.log(` - Company: ${backup.company?.name}`);
  console.log(` - Users Provisioned: ${usersRestored}`);
  console.log(` - Company Memberships: ${membershipsRestored}`);
  console.log(` - Manager Reporting Lines: ${managerLinesLinked} links`);
  console.log(` - Teams Restored: ${teamsRestored}`);
  console.log(` - OKR Objectives: ${objectivesRestored}`);
  console.log(` - Goal Permissions: ${objectiveAccessRestored}`);
  console.log(` - Key Results: ${keyResultsRestored}`);
  console.log(` - Key Result Editors: ${keyResultEditorsRestored}`);
  console.log(` - Check-in History: ${checkInsRestored}`);
  console.log(` - Invitations: ${invitationsRestored}`);
  console.log(` - Notifications: ${notificationsRestored}`);
  console.log(` - Audit Trail: ${auditLogsRestored}`);
  console.log(`-------------------------------------------------------`);
  console.log(` SECURE CREDENTIALS PROVISIONING:`);
  console.log(` - Unique high-entropy temporary passwords & 24h reset tokens`);
  console.log(`   were provisioned for all restored users.`);
  console.log(` - Credentials manifest securely saved to:`);
  console.log(`   ${credsPath} (file mode 0600)`);
  if (process.env.RECOVERY_PASSWORD) {
    console.log(` - [NOTE] Custom override password provided via RECOVERY_PASSWORD.`);
  }
  console.log(`=======================================================\n`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error("FATAL: Restore failed, transaction rolled back safely.", error);
  process.exit(1);
} finally {
  await client.end();
}
