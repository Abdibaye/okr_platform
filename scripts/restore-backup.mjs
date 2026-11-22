#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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

const defaultPasswordHash = await hashPassword("RecoveryPass123!");

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

  // Normalize Users and Memberships
  // Staff entries provide user identity + company membership + reporting lines
  const rawUsers = backup.users || [];
  const rawStaff = backup.staff || backup.memberships || [];
  const rawMemberships = backup.companyMemberships || [];

  // Consolidate unique users
  const userMap = new Map();
  for (const u of rawUsers) {
    if (u.id) userMap.set(u.id, { id: u.id, name: u.name || "", email: u.email || "", image: u.image || null });
  }
  for (const s of rawStaff) {
    const uid = s.userId || s.id;
    if (uid && !userMap.has(uid)) {
      userMap.set(uid, { id: uid, name: s.name || "", email: s.email || "", image: null });
    }
  }

  // 2. Restore Users & Auth Credentials
  let usersRestored = 0;
  for (const user of userMap.values()) {
    if (!user.email) continue;
    console.log(`  Restoring user ${user.name} (${user.email}, ${user.id})...`);
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, image, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         image = EXCLUDED.image,
         updated_at = NOW()`,
      [user.id, user.name, user.email, user.image]
    );

    // Ensure account record exists for password logins
    const existingAccount = await client.query(
      `SELECT id FROM account WHERE user_id = $1 AND provider_id = 'credential'`,
      [user.id]
    );
    if (existingAccount.rowCount === 0) {
      await client.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, 'credential', $1, $2, NOW(), NOW())`,
        [user.id, defaultPasswordHash]
      );
    }
    usersRestored++;
  }
  console.log(`✓ Restored ${usersRestored} User identities & auth credentials`);

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
      });
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
         COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, NULL, $5, $6, $7, NOW(), NOW()
       )
       ON CONFLICT (company_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         job_title = EXCLUDED.job_title,
         is_active = EXCLUDED.is_active,
         deactivated_at = EXCLUDED.deactivated_at,
         updated_at = NOW()`,
      [m.id, m.companyId, m.userId, m.role, m.jobTitle, m.isActive, m.deactivatedAt]
    );
    membershipsRestored++;
  }
  console.log(`✓ Restored ${membershipsRestored} Company Memberships (Pass 1: base roles & profiles)`);

  // 4. Restore Manager Reporting Lines (Pass 2 - Hierarchy linking)
  let managerLinesLinked = 0;
  for (const m of membershipMap.values()) {
    if (m.managerId) {
      // Check if manager user exists
      const mgrExists = await client.query(`SELECT id FROM "user" WHERE id = $1`, [m.managerId]);
      if (mgrExists.rowCount > 0 && m.managerId !== m.userId) {
        await client.query(
          `UPDATE company_memberships
           SET manager_id = $1, updated_at = NOW()
           WHERE company_id = $2 AND user_id = $3`,
          [m.managerId, m.companyId, m.userId]
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
    await client.query(
      `INSERT INTO teams (id, company_id, name, description, lead_user_id, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         lead_user_id = EXCLUDED.lead_user_id,
         archived_at = EXCLUDED.archived_at,
         updated_at = NOW()`,
      [t.id, t.companyId, t.name, t.description || "", t.leadUserId || null, t.archivedAt || null, t.createdAt || null, t.updatedAt || null]
    );
    teamsRestored++;
  }
  console.log(`✓ Restored ${teamsRestored} Teams`);

  // 6. Restore Team Memberships
  const teamMemberships = backup.teamMemberships || [];
  let teamMembershipsRestored = 0;
  for (const tm of teamMemberships) {
    if (!tm.teamId || !tm.userId || !tm.companyId) continue;
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
         updated_at = NOW()`,
      [
        c.id, c.companyId, c.name, c.startDate, c.endDate, c.status || "open",
        c.finalReflection || "", c.requireApproval || false, c.checkInCadence || "weekly",
        c.archivedAt || null, c.version || 1, c.createdBy, c.createdAt || null, c.updatedAt || null
      ]
    );
    cyclesRestored++;
  }
  console.log(`✓ Restored ${cyclesRestored} OKR Planning Cycles`);

  // 8. Restore Objectives (Pass 1: base objectives; Pass 2: parent alignment)
  const objectives = backup.objectives || [];
  let objectivesRestored = 0;
  for (const obj of objectives) {
    if (!obj.id || !obj.companyId || !obj.cycleId || !obj.title) continue;
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
         $15, NULL, $16, $17,
         $18, $19, COALESCE($20::timestamptz, NOW()), COALESCE($21::timestamptz, NOW())
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
         visibility = EXCLUDED.visibility,
         archived_at = EXCLUDED.archived_at,
         version = EXCLUDED.version,
         updated_at = NOW()`,
      [
        obj.id, obj.companyId, obj.cycleId, obj.title, obj.description || "",
        obj.progress || "0", obj.level || "company", obj.teamId || null,
        obj.ownerId || null, obj.dueDate || null, obj.status || "active",
        obj.approvalStatus || "approved", obj.approvedBy || null, obj.approvedAt || null,
        obj.visibility || "company", obj.copiedFromObjectiveId || null,
        obj.archivedAt || null, obj.version || 1, obj.createdBy,
        obj.createdAt || null, obj.updatedAt || null
      ]
    );
    objectivesRestored++;
  }

  // Pass 2: Parent objective linking
  let parentAlignmentsLinked = 0;
  for (const obj of objectives) {
    if (obj.parentObjectiveId) {
      await client.query(
        `UPDATE objectives
         SET parent_objective_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [obj.parentObjectiveId, obj.id]
      );
      parentAlignmentsLinked++;
    }
  }
  console.log(`✓ Restored ${objectivesRestored} Objectives (${parentAlignmentsLinked} parent alignments linked)`);

  // 9. Restore Key Results
  const keyResults = backup.keyResults || [];
  let keyResultsRestored = 0;
  for (const kr of keyResults) {
    if (!kr.id || !kr.companyId || !kr.objectiveId || !kr.title) continue;
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
         updated_at = NOW()`,
      [
        kr.id, kr.companyId, kr.objectiveId, kr.title, kr.metricType || "numeric",
        kr.direction || "increasing", kr.unit || "", kr.baseline || "0", kr.target || "100",
        kr.current || "0", kr.progress || "0", kr.ownerId || null, kr.dueDate || null,
        kr.confidence || "on_track", kr.lastCheckInAt || null, kr.lastEffectiveDate || null,
        kr.archivedAt || null, kr.version || 1, kr.createdAt || null, kr.updatedAt || null
      ]
    );
    keyResultsRestored++;
  }
  console.log(`✓ Restored ${keyResultsRestored} Key Results`);

  // 10. Restore KR Check-Ins
  const checkIns = backup.checkIns || [];
  let checkInsRestored = 0;
  for (const ci of checkIns) {
    if (!ci.id || !ci.companyId || !ci.keyResultId) continue;
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

  // 11. Restore Comments
  const comments = backup.comments || [];
  let commentsRestored = 0;
  for (const cm of comments) {
    if (!cm.id || !cm.companyId || !cm.objectiveId) continue;
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

  // 12. Restore Audit Logs
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

  // 13. Recalculate Parent Objective Progress
  const progressRecalc = await client.query(`
    WITH kr_averages AS (
      SELECT
        objective_id,
        ROUND(AVG(progress), 2) AS calculated_progress
      FROM key_results
      WHERE archived_at IS NULL
      GROUP BY objective_id
    )
    UPDATE objectives o
    SET
      progress = ka.calculated_progress,
      updated_at = NOW()
    FROM kr_averages ka
    WHERE o.id = ka.objective_id AND o.archived_at IS NULL
    RETURNING o.id, o.title, o.progress
  `);
  console.log(`✓ Recalculated aggregate progress for ${progressRecalc.rowCount} objectives`);

  await client.query("COMMIT");

  console.log(`\n=======================================================`);
  console.log(` RESTORE COMPLETED SUCCESSFULLY!`);
  console.log(` - Company: ${backup.company?.name}`);
  console.log(` - Staff Directory: ${staffRestoredCount(backup)} records`);
  console.log(` - Manager Reporting Lines: ${managerLinesLinked} links`);
  console.log(` - OKR Objectives: ${objectivesRestored}`);
  console.log(` - Key Results: ${keyResultsRestored}`);
  console.log(` - Default Login Password for Restored Users: RecoveryPass123!`);
  console.log(`=======================================================\n`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error("FATAL: Restore failed, transaction rolled back safely.", error);
  process.exit(1);
} finally {
  await client.end();
}

function staffRestoredCount(b) {
  return (b.staff || b.memberships || b.companyMemberships || []).length;
}
