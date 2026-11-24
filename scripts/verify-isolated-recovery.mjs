import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { verifyPassword } from "better-auth/crypto";

const baseEnvUrl = process.env.DATABASE_URL;
if (!baseEnvUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

// Use direct endpoint (no pooler) for DDL CREATE/DROP DATABASE
const directBaseUrl = baseEnvUrl.replace("-pooler", "");

function getDbUrl(dbName) {
  const u = new URL(directBaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function resolveEvidenceFile(fileName) {
  const candidates = [
    process.env.EVIDENCE_DIR ? path.join(process.env.EVIDENCE_DIR, fileName) : null,
    process.argv[2] ? path.join(process.argv[2], fileName) : null,
    path.resolve("tests/fixtures/recovery-evidence", fileName),
    path.resolve("alineo-recovery-test-evidence", fileName),
    process.env.HOME ? path.join(process.env.HOME, "Downloads/alineo-recovery-test-evidence", fileName) : null,
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return path.resolve(c);
    }
  }
  throw new Error(`Evidence file "${fileName}" not found in any candidate path. Checked: ${candidates.join(", ")}`);
}

async function withClient(connectionString, callback) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 30000 });
  client.on("error", () => {}); // Prevent unhandled error events on idle/closed sockets
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end().catch(() => {});
  }
}

const DB1 = "alineo_test_db_issue1";
const DB2 = "alineo_test_db_issue2";

async function main() {
  console.log("=======================================================");
  console.log(" Running Isolated Dual-Database Recovery Verification");
  console.log("=======================================================\n");

  const test1File = resolveEvidenceFile("submitted-workspace-recovery.json");
  const test2File = resolveEvidenceFile("published-export-2026-11-23-0151UTC.json");
  const diffFile = resolveEvidenceFile("progress-value-differences.json");

  console.log("Resolved test fixtures:");
  console.log(` - Test 1 fixture: ${test1File}`);
  console.log(` - Test 2 fixture: ${test2File}`);
  console.log(` - Diff fixture:   ${diffFile}\n`);

  try {
    // 1. Prepare isolated DBs
    console.log("1. Preparing isolated test databases...");
    await withClient(directBaseUrl, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${DB1}`);
      await c.query(`CREATE DATABASE ${DB1}`);
      console.log(`✓ Created isolated database: ${DB1}`);

      await c.query(`DROP DATABASE IF EXISTS ${DB2}`);
      await c.query(`CREATE DATABASE ${DB2}`);
      console.log(`✓ Created isolated database: ${DB2}`);
    });

    // 2. Run migrations on both
    console.log("\n2. Applying migrations to isolated databases...");
    execSync(`DATABASE_URL="${getDbUrl(DB1)}" node .neander/migrate.mjs`, { stdio: "inherit" });
    execSync(`DATABASE_URL="${getDbUrl(DB2)}" node .neander/migrate.mjs`, { stdio: "inherit" });
    console.log("✓ Migrations applied successfully to both databases.");

    // 3. Test Issue 1: submitted-workspace-recovery.json (copied goals ordering)
    console.log("\n=======================================================");
    console.log(" TEST 1: submitted-workspace-recovery.json (Issue 1)");
    console.log("=======================================================");
    execSync(`DATABASE_URL="${getDbUrl(DB1)}" node scripts/restore-backup.mjs "${test1File}"`, { stdio: "inherit" });

    const credsPath = path.resolve("docs/recovery/recovery-credentials.json");
    const credsData1 = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    const sampleUser = credsData1.credentials[0];

    // Verify DB1 data
    await withClient(getDbUrl(DB1), async (client1) => {
      const objCount1 = await client1.query("SELECT COUNT(*) FROM objectives");
      const copiedGoal = await client1.query(
        `SELECT id, title, copied_from_objective_id, parent_objective_id, progress
         FROM objectives
         WHERE id = '7861e63c-4494-4be6-82d8-8340011c5eac'`
      );
      const targetGoal = await client1.query(
        `SELECT id, title FROM objectives WHERE id = '1037d7e4-7ff8-412d-bc32-e0aa2e961070'`
      );

      console.log("\n--- TEST 1 VERIFICATION RESULTS ---");
      console.log(`Total objectives in DB1: ${objCount1.rows[0].count} (expected 35)`);
      console.log("Copied goal row in DB1:", copiedGoal.rows[0]);
      console.log("Target goal row in DB1:", targetGoal.rows[0]);

      if (objCount1.rows[0].count !== "35") {
        throw new Error(`DB1 objective count mismatch: expected 35, got ${objCount1.rows[0].count}`);
      }
      if (copiedGoal.rows[0]?.copied_from_objective_id !== "1037d7e4-7ff8-412d-bc32-e0aa2e961070") {
        throw new Error(`Copied goal foreign key not linked correctly! Got: ${copiedGoal.rows[0]?.copied_from_objective_id}`);
      }
      console.log(">>> TEST 1 PASSED: Copied goals restored cleanly without foreign key violation! <<<\n");

      // 4. Test Password Reset Tokens (Verification table contract)
      console.log("=======================================================");
      console.log(" TEST 1B: Password Reset Verification Tokens");
      console.log("=======================================================");

      console.log(`Verifying password reset token for user: ${sampleUser.email} (${sampleUser.userId})...`);
      console.log(`Token: ${sampleUser.resetToken}`);
      console.log(`Reset URL: ${sampleUser.resetUrl}`);

      const verifyRow = await client1.query(
        `SELECT id, identifier, value, expires_at FROM verification WHERE identifier = $1`,
        [`reset-password:${sampleUser.resetToken}`]
      );

      if (verifyRow.rowCount === 0) {
        throw new Error(`Verification row not found for identifier 'reset-password:${sampleUser.resetToken}'`);
      }
      if (verifyRow.rows[0].value !== sampleUser.userId) {
        throw new Error(`Verification value mismatch: expected userId ${sampleUser.userId}, got ${verifyRow.rows[0].value}`);
      }
      if (new Date(verifyRow.rows[0].expires_at) <= new Date()) {
        throw new Error("Verification token has already expired!");
      }
      console.log("✓ Verification token correctly registered with Better Auth schema contract:");
      console.log(`  identifier: ${verifyRow.rows[0].identifier}`);
      console.log(`  value:      ${verifyRow.rows[0].value} (matches userId)`);
      console.log(`  expires_at: ${verifyRow.rows[0].expires_at}`);
      console.log(">>> TEST 1B PASSED: Password reset tokens conform to application auth schema! <<<\n");
    });

    // 5. Test Repeat Restore, Session Revocation & Existing Account Credential Update
    console.log("=======================================================");
    console.log(" TEST 1C: Repeat Restore, Session Revocation & Credentials");
    console.log("=======================================================");
    console.log("Simulating an active signed-in session before repeat restore...");

    const testToken = "test-active-session-" + crypto.randomBytes(16).toString("hex");
    const testSessionId = "test-session-id-" + crypto.randomBytes(16).toString("hex");
    const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await withClient(getDbUrl(DB1), async (client1) => {
      await client1.query(
        `INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
         VALUES ($1, $2, $3, NOW(), NOW(), '127.0.0.1', 'Mozilla/5.0 Test Suite', $4)`,
        [testSessionId, sessionExpiresAt, testToken, sampleUser.userId]
      );
      const preCheck = await client1.query(`SELECT id FROM session WHERE token = $1`, [testToken]);
      if (preCheck.rowCount !== 1) {
        throw new Error("Failed to seed active test session!");
      }
      console.log(`✓ Seeded active session for user ${sampleUser.email} (token: ${testToken.slice(0, 24)}...)`);
    });

    // Explicitly create file with 0644 to test permissions overwrite enforcement
    fs.writeFileSync(credsPath, "{}", { mode: 0o644 });
    fs.chmodSync(credsPath, 0o644);
    const preMode = (fs.statSync(credsPath).mode & 0o777).toString(8);
    console.log(`Pre-restore file mode set to: 0${preMode} (testing 0600 overwrite enforcement)`);

    execSync(`DATABASE_URL="${getDbUrl(DB1)}" node scripts/restore-backup.mjs "${test1File}"`, { stdio: "inherit" });

    const postMode = (fs.statSync(credsPath).mode & 0o777).toString(8);
    console.log(`Post-restore file mode: 0${postMode} (expected 0600)`);
    if (postMode !== "600") {
      throw new Error(`File permission not enforced! Expected 0600, got 0${postMode}`);
    }

    console.log("\nVerifying that old session is revoked and rejected...");
    await withClient(getDbUrl(DB1), async (client1) => {
      // 1. Verify old session token was revoked in PostgreSQL session store
      const postSession = await client1.query(`SELECT id, token FROM session WHERE token = $1`, [testToken]);
      if (postSession.rowCount !== 0) {
        throw new Error(`Old session token ${testToken} was NOT revoked! Still present in session table.`);
      }
      console.log("✓ Pre-existing session token was successfully revoked within restore transaction (rejected by session store)!");

      // 2. Verify all sessions for affected user are 0
      const userSessions = await client1.query(`SELECT COUNT(*) FROM session WHERE user_id = $1`, [sampleUser.userId]);
      if (Number(userSessions.rows[0].count) !== 0) {
        throw new Error(`User still has ${userSessions.rows[0].count} active sessions! Expected 0.`);
      }
      console.log(`✓ All active sessions for affected user ${sampleUser.email} revoked (count: 0)`);

      // 3. Verify that newly generated manifest passwords work against existing accounts
      const credsData2 = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      console.log("\nVerifying that newly listed manifest passwords work against existing accounts...");
      for (const cred of credsData2.credentials) {
        const accRes = await client1.query(
          `SELECT password FROM account WHERE user_id = $1 AND provider_id = 'credential'`,
          [cred.userId]
        );
        if (accRes.rowCount === 0) {
          throw new Error(`Account record missing for user ${cred.email}`);
        }
        const storedHash = accRes.rows[0].password;
        const valid = await verifyPassword({
          hash: storedHash,
          password: cred.temporaryPassword,
        });
        if (!valid) {
          throw new Error(`Password in account does not match temporaryPassword listed in recovery-credentials.json for ${cred.email}!`);
        }
      }
      console.log(`✓ All ${credsData2.credentials.length} user accounts successfully authenticated with newly listed passwords!`);
      console.log(">>> TEST 1C PASSED: Old session rejected AND new manifest passwords work! <<<\n");
    });

    // 6. Test Issue 2: published-export-2026-11-23-0151UTC.json (progress value fidelity)
    console.log("\n=======================================================");
    console.log(" TEST 2: published-export-2026-11-23-0151UTC.json (Issue 2)");
    console.log("=======================================================");
    execSync(`DATABASE_URL="${getDbUrl(DB2)}" node scripts/restore-backup.mjs "${test2File}"`, { stdio: "inherit" });

    // Verify DB2 data
    await withClient(getDbUrl(DB2), async (client2) => {
      const diffList = JSON.parse(fs.readFileSync(diffFile, "utf8"));

      console.log(`\n--- TEST 2 VERIFICATION RESULTS ---`);
      console.log(`Checking ${diffList.length} objectives that previously erroneously changed from null to 0.00...`);

      let mismatches = 0;
      for (const item of diffList) {
        const res = await client2.query("SELECT id, title, progress FROM objectives WHERE id = $1", [item.id]);
        const row = res.rows[0];
        if (!row) {
          console.error(`Objective ${item.id} not found!`);
          mismatches++;
        } else if (row.progress !== null) {
          console.error(`Mismatch on ${item.id} ("${row.title}"): expected null, got ${row.progress}`);
          mismatches++;
        }
      }

      const sample47 = await client2.query("SELECT id, title, progress FROM objectives WHERE id = '307300d2-5fe9-41bc-83d4-37a53eedbb5e'");
      console.log(`Checking objective with expected 47.50 progress: id=${sample47.rows[0]?.id}, progress=${sample47.rows[0]?.progress}`);

      const nullCountRes = await client2.query("SELECT COUNT(*) FROM objectives WHERE progress IS NULL");
      console.log(`Total objectives with NULL progress in DB2: ${nullCountRes.rows[0].count} (expected 22)`);

      if (mismatches > 0) {
        throw new Error(`TEST 2 FAILED: ${mismatches} objectives had progress value mismatches!`);
      }
      if (nullCountRes.rows[0].count !== "22") {
        throw new Error(`Expected exactly 22 null progress objectives, found ${nullCountRes.rows[0].count}`);
      }
      if (sample47.rows[0]?.progress !== "47.50") {
        throw new Error(`Expected progress 47.50, got ${sample47.rows[0]?.progress}`);
      }

      console.log(">>> TEST 2 PASSED: All 22 objectives preserved progress: null with zero alterations! <<<\n");
    });

    console.log("=======================================================");
    console.log(" ALL ISOLATED RECOVERY VERIFICATION CHECKS PASSED 100%!");
    console.log("=======================================================\n");

  } finally {
    console.log("Cleaning up isolated test databases...");
    await withClient(directBaseUrl, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${DB1}`);
      await c.query(`DROP DATABASE IF EXISTS ${DB2}`);
      console.log(`✓ Cleaned up ${DB1} and ${DB2}`);
    }).catch((err) => {
      console.warn("Cleanup warning:", err.message);
    });
  }
}

main().catch((err) => {
  console.error("FATAL VERIFICATION ERROR:", err);
  process.exit(1);
});
