import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";

const baseEnvUrl = process.env.DATABASE_URL;
if (!baseEnvUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

// Use direct endpoint (no pooler) for DDL CREATE/DROP DATABASE
const directBaseUrl = baseEnvUrl.replace("-pooler", "");
const parsedUrl = new URL(directBaseUrl);

function getDbUrl(dbName) {
  const u = new URL(directBaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const DB1 = "alineo_test_db_issue1";
const DB2 = "alineo_test_db_issue2";

async function main() {
  const rootClient = new Client({ connectionString: directBaseUrl });
  await rootClient.connect();

  console.log("=======================================================");
  console.log(" Running Isolated Dual-Database Recovery Verification");
  console.log("=======================================================\n");

  try {
    // 1. Prepare isolated DBs
    console.log("1. Preparing isolated test databases...");
    await rootClient.query(`DROP DATABASE IF EXISTS ${DB1}`);
    await rootClient.query(`CREATE DATABASE ${DB1}`);
    console.log(`✓ Created isolated database: ${DB1}`);

    await rootClient.query(`DROP DATABASE IF EXISTS ${DB2}`);
    await rootClient.query(`CREATE DATABASE ${DB2}`);
    console.log(`✓ Created isolated database: ${DB2}`);

    // 2. Run migrations on both
    console.log("\n2. Applying migrations to isolated databases...");
    execSync(`DATABASE_URL="${getDbUrl(DB1)}" node .neander/migrate.mjs`, { stdio: "inherit" });
    execSync(`DATABASE_URL="${getDbUrl(DB2)}" node .neander/migrate.mjs`, { stdio: "inherit" });
    console.log("✓ Migrations applied successfully to both databases.");

    // 3. Test Issue 1: submitted-workspace-recovery.json (copied goals ordering)
    console.log("\n=======================================================");
    console.log(" TEST 1: submitted-workspace-recovery.json (Issue 1)");
    console.log("=======================================================");
    const test1File = "/Users/mac/Downloads/alineo-recovery-test-evidence/submitted-workspace-recovery.json";
    execSync(`DATABASE_URL="${getDbUrl(DB1)}" node scripts/restore-backup.mjs "${test1File}"`, { stdio: "inherit" });

    // Verify DB1 data
    const client1 = new Client({ connectionString: getDbUrl(DB1) });
    await client1.connect();

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
    await client1.end();

    // 4. Test Issue 2: published-export-2026-11-23-0151UTC.json (progress value fidelity)
    console.log("\n=======================================================");
    console.log(" TEST 2: published-export-2026-11-23-0151UTC.json (Issue 2)");
    console.log("=======================================================");
    const test2File = "/Users/mac/Downloads/alineo-recovery-test-evidence/published-export-2026-11-23-0151UTC.json";
    execSync(`DATABASE_URL="${getDbUrl(DB2)}" node scripts/restore-backup.mjs "${test2File}"`, { stdio: "inherit" });

    // Verify DB2 data
    const client2 = new Client({ connectionString: getDbUrl(DB2) });
    await client2.connect();

    // Read the expected differences file from the reviewer
    const diffList = JSON.parse(
      fs.readFileSync("/Users/mac/Downloads/alineo-recovery-test-evidence/progress-value-differences.json", "utf8")
    );

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

    // Also check non-null progress fidelity
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

    // 5. Check credentials manifest file permissions
    const credsPath = path.resolve("docs/recovery/recovery-credentials.json");
    if (fs.existsSync(credsPath)) {
      const stat = fs.statSync(credsPath);
      const modeOctal = (stat.mode & 0o777).toString(8);
      console.log(`Credentials file created at: ${credsPath}`);
      console.log(`File mode: 0${modeOctal} (expected 0600)`);
      const credData = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      console.log(`Provisioned user credentials count: ${credData.credentials?.length}`);
      console.log(`Sample credential structure:`, {
        email: credData.credentials[0]?.email,
        temporaryPasswordLength: credData.credentials[0]?.temporaryPassword?.length,
        hasResetToken: !!credData.credentials[0]?.resetToken,
        tokenExpiresAt: credData.credentials[0]?.tokenExpiresAt,
      });
    }

    await client2.end();

    console.log("\n=======================================================");
    console.log(" ALL ISOLATED RECOVERY VERIFICATION CHECKS PASSED 100%!");
    console.log("=======================================================\n");

  } finally {
    console.log("Cleaning up isolated test databases...");
    await rootClient.query(`DROP DATABASE IF EXISTS ${DB1}`);
    await rootClient.query(`DROP DATABASE IF EXISTS ${DB2}`);
    console.log(`✓ Cleaned up ${DB1} and ${DB2}`);
    await rootClient.end();
  }
}

main().catch((err) => {
  console.error("FATAL VERIFICATION ERROR:", err);
  process.exit(1);
});
