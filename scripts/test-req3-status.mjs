import assert from "node:assert/strict";
import dns from "node:dns";
import { Client } from "pg";
import { hashPassword } from "better-auth/crypto";

const origLookup = dns.lookup;
dns.lookup = (h, opt, cb) => {
  if (typeof opt === "function") { cb = opt; opt = {}; }
  if (typeof h === "string" && h.includes("neon.tech")) {
    const ip = "3.147.219.177";
    if (opt && opt.all) return cb(null, [{ address: ip, family: 4 }]);
    return cb(null, ip, 4);
  }
  return origLookup(h, opt, cb);
};

const ORIGIN = process.argv[2] || "http://127.0.0.1:3003";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in environment");

const pg = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 60000,
});
await pg.connect();

console.log(`\n===============================================================`);
console.log(`Checking Status of Requirement 3:`);
console.log(`"Notify new owners when goals/KRs are assigned"`);
console.log(`Target server: ${ORIGIN}`);
console.log(`===============================================================\n`);

const testSuffix = Math.random().toString(36).substring(2, 8);
const companyId = crypto.randomUUID();
const cycleId = crypto.randomUUID();
const testPassword = "MockPassword123!";
const passwordHash = await hashPassword(testPassword);

const users = {
  admin: { id: crypto.randomUUID(), email: `admin-${testSuffix}@test.local`, name: "Admin User", role: "admin", companyId, cookie: "" },
  member1: { id: crypto.randomUUID(), email: `member1-${testSuffix}@test.local`, name: "Member One", role: "member", companyId, cookie: "" },
  member2: { id: crypto.randomUUID(), email: `member2-${testSuffix}@test.local`, name: "Member Two", role: "member", companyId, cookie: "" },
};

async function api(path, method, body, asUser) {
  const headers = {
    "Content-Type": "application/json",
    "Cookie": `${asUser.cookie}; active_company_id=${asUser.companyId}`,
    "Origin": ORIGIN,
  };
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, body: data };
}

try {
  // 1. Setup workspace & accounts
  await pg.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [
    companyId, `Req3 Test ${testSuffix}`,
  ]);

  for (const [key, u] of Object.entries(users)) {
    await pg.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ($1, $2, $3, true)
    `, [u.id, u.name, u.email]);

    await pg.query(`
      INSERT INTO company_memberships (id, company_id, user_id, role, is_active)
      VALUES ($1, $2, $3, $4, true)
    `, [crypto.randomUUID(), companyId, u.id, u.role]);

    await pg.query(`
      INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'credential', $1, $2, now(), now())
    `, [u.id, passwordHash]);

    // Sign in to get session cookie
    const signInRes = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": ORIGIN },
      body: JSON.stringify({ email: u.email, password: testPassword }),
    });
    const setCookie = signInRes.headers.get("set-cookie");
    if (!setCookie) throw new Error(`Failed to sign in as ${u.email}: ${signInRes.status}`);
    u.cookie = setCookie.split(";")[0];
  }

  await pg.query(`
    INSERT INTO okr_cycles (id, company_id, name, start_date, end_date, status, require_approval, created_by)
    VALUES ($1, $2, 'Active Cycle', '2026-01-01', '2026-12-31', 'open', false, $3)
  `, [cycleId, companyId, users.admin.id]);

  console.log("✓ Test users & cycle setup complete");

  // Helper to check notifications in DB for a user
  async function getNotificationsFor(userId) {
    const { rows } = await pg.query(`
      SELECT id, type, title, body, entity_type, entity_id, read_at, created_at
      FROM notifications
      WHERE company_id = $1 AND recipient_id = $2
      ORDER BY created_at DESC
    `, [companyId, userId]);
    return rows;
  }

  // --- Test Case 1: Goal Creation with Assigned Owner ---
  console.log("\n[Test 1] Admin creates a goal assigned to Member 1...");
  const createGoalRes = await api("/api/objectives", "POST", {
    cycleId,
    title: "Q1 Revenue Growth",
    description: "Grow revenue",
    level: "individual",
    ownerId: users.member1.id,
    visibility: "company",
  }, users.admin);
  console.log(`Goal creation HTTP response: ${createGoalRes.status}`);
  const goalId = createGoalRes.body?.objective?.id;
  let goalVersion = createGoalRes.body?.objective?.version;

  const member1NotifsAfterGoalCreate = await getNotificationsFor(users.member1.id);
  console.log(`Notifications received by Member 1 after goal creation:`, member1NotifsAfterGoalCreate);
  const test1Status = member1NotifsAfterGoalCreate.some(n => n.entity_id === goalId) ? "IMPLEMENTED" : "NOT IMPLEMENTED (0 notifications created)";
  console.log(`Test 1 Result: ${test1Status}`);

  // --- Test Case 2: Goal Reassignment ---
  console.log("\n[Test 2] Admin reassigns goal from Member 1 to Member 2...");
  const reassignGoalRes = await api(`/api/objectives/${goalId}`, "PATCH", {
    version: goalVersion,
    ownerId: users.member2.id,
  }, users.admin);
  console.log(`Goal reassignment HTTP response: ${reassignGoalRes.status}`);
  goalVersion = reassignGoalRes.body?.objective?.version;

  const member2NotifsAfterGoalReassign = await getNotificationsFor(users.member2.id);
  console.log(`Notifications received by Member 2 after goal reassignment:`, member2NotifsAfterGoalReassign);
  const test2Status = member2NotifsAfterGoalReassign.some(n => n.entity_id === goalId) ? "IMPLEMENTED" : "NOT IMPLEMENTED (0 notifications created)";
  console.log(`Test 2 Result: ${test2Status}`);

  // --- Test Case 3: KR Creation with Assigned Owner ---
  console.log("\n[Test 3] Admin creates a Key Result assigned to Member 1...");
  const createKrRes = await api("/api/key-results", "POST", {
    objectiveId: goalId,
    title: "Achieve $1M ARR",
    metricType: "currency",
    direction: "increasing",
    baseline: 0,
    target: 1000000,
    current: 0,
    ownerId: users.member1.id,
  }, users.admin);
  console.log(`KR creation HTTP response: ${createKrRes.status}`);
  const krId = createKrRes.body?.keyResult?.id;
  let krVersion = createKrRes.body?.keyResult?.version;

  const member1NotifsAfterKrCreate = await getNotificationsFor(users.member1.id);
  console.log(`Notifications received by Member 1 after KR creation:`, member1NotifsAfterKrCreate);
  const test3Status = member1NotifsAfterKrCreate.some(n => n.entity_id === krId) ? "IMPLEMENTED" : "NOT IMPLEMENTED (0 notifications created)";
  console.log(`Test 3 Result: ${test3Status}`);

  // --- Test Case 4: KR Reassignment ---
  console.log("\n[Test 4] Admin reassigns Key Result from Member 1 to Member 2...");
  const reassignKrRes = await api(`/api/key-results/${krId}`, "PATCH", {
    version: krVersion,
    ownerId: users.member2.id,
  }, users.admin);
  console.log(`KR reassignment HTTP response: ${reassignKrRes.status}`);

  const member2NotifsAfterKrReassign = await getNotificationsFor(users.member2.id);
  console.log(`Notifications received by Member 2 after KR reassignment:`, member2NotifsAfterKrReassign);
  const test4Status = member2NotifsAfterKrReassign.some(n => n.entity_id === krId) ? "IMPLEMENTED" : "NOT IMPLEMENTED (0 notifications created)";
  console.log(`Test 4 Result: ${test4Status}`);

  // Summary
  console.log(`\n===============================================================`);
  console.log(`SUMMARY OF REQUIREMENT 3 CURRENT STATUS:`);
  console.log(`1. Goal assigned upon creation: ${test1Status}`);
  console.log(`2. Goal reassigned to new owner: ${test2Status}`);
  console.log(`3. KR assigned upon creation: ${test3Status}`);
  console.log(`4. KR reassigned to new owner: ${test4Status}`);
  console.log(`===============================================================\n`);

} finally {
  console.log("Cleaning up test data...");
  await pg.query(`DELETE FROM notifications WHERE company_id = $1`, [companyId]);
  await pg.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
  await pg.query(`DELETE FROM kr_check_ins WHERE company_id = $1`, [companyId]);
  await pg.query(`DELETE FROM key_results WHERE company_id = $1`, [companyId]);
  await pg.query(`DELETE FROM objectives WHERE company_id = $1`, [companyId]);
  await pg.query(`DELETE FROM okr_cycles WHERE company_id = $1`, [companyId]);
  await pg.query(`DELETE FROM company_memberships WHERE company_id = $1`, [companyId]);
  for (const u of Object.values(users)) {
    await pg.query(`DELETE FROM session WHERE user_id = $1`, [u.id]);
    await pg.query(`DELETE FROM account WHERE user_id = $1`, [u.id]);
    await pg.query(`DELETE FROM "user" WHERE id = $1`, [u.id]);
  }
  await pg.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await pg.end();
  console.log("Cleanup done.");
}
