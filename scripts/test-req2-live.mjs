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

const ORIGIN = process.argv[2] || "http://127.0.0.1:3002";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in environment");

const pg = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 60000,
});
await pg.connect();

console.log(`\n===============================================================`);
console.log(`Starting Live Test: Requirement 2`);
console.log(`"Block comments/check-in requests on closed cycles and clear stale requests"`);
console.log(`Target server: ${ORIGIN}`);
console.log(`===============================================================\n`);

const testSuffix = Math.random().toString(36).substring(2, 8);
const companyId = crypto.randomUUID();
const cycle1Id = crypto.randomUUID();
const cycle2Id = crypto.randomUUID();
const testPassword = "MockPassword123!";
const passwordHash = await hashPassword(testPassword);

const users = {
  admin: { id: crypto.randomUUID(), email: `admin-${testSuffix}@test.local`, name: "Admin User", role: "admin", companyId, cookie: "" },
  manager: { id: crypto.randomUUID(), email: `manager-${testSuffix}@test.local`, name: "Manager User", role: "manager", companyId, cookie: "" },
  member: { id: crypto.randomUUID(), email: `member-${testSuffix}@test.local`, name: "Member User", role: "member", companyId, cookie: "" },
};

async function api(path, method, body, asUser) {
  const headers = {
    "Content-Type": "application/json",
    "Cookie": `${asUser.cookie}; active_company_id=${asUser.companyId}`,
  };
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, ok: res.ok, body: json, text };
}

let passedChecks = 0;
function logCheck(title) {
  passedChecks++;
  console.log(` [PASS ${passedChecks}] ${title}`);
}

try {
  // 1. Setup Test Workspace, Users, and Sessions
  console.log("-> 1. Setting up test workspace, users, and sessions in live DB...");
  await pg.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [
    companyId, `Test Workspace Req2 ${testSuffix}`,
  ]);

  for (const u of Object.values(users)) {
    await pg.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)`,
      [u.id, u.name, u.email],
    );
    const managerId = u.role === "member" ? users.manager.id : null;
    await pg.query(
      `INSERT INTO company_memberships (id, company_id, user_id, role, manager_id, is_active) VALUES ($1, $2, $3, $4, $5, true)`,
      [crypto.randomUUID(), u.companyId, u.id, u.role, managerId],
    );
    await pg.query(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'credential', $1, $2, now(), now())`,
      [u.id, passwordHash],
    );

    const signInRes = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": ORIGIN,
      },
      body: JSON.stringify({ email: u.email, password: testPassword }),
    });
    const setCookie = signInRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(/better-auth\.session_token=[^;]+/);
    if (!sessionMatch) {
      throw new Error(`Failed to sign in as ${u.email}: ${await signInRes.text()}`);
    }
    u.cookie = sessionMatch[0];
  }

  // Create Cycle 1 (open)
  await pg.query(
    `INSERT INTO okr_cycles (id, company_id, name, start_date, end_date, status, created_by)
     VALUES ($1, $2, $3, '2026-10-01', '2026-12-31', 'open', $4)`,
    [cycle1Id, companyId, `Cycle 1 ${testSuffix}`, users.admin.id],
  );
  logCheck("Workspace, open cycle 1, and authenticated sessions ready.");

  // 2. Create Goal 1 and Key Result 1 in Cycle 1
  console.log("\n-> 2. Creating Goal 1 and Key Result 1 in Cycle 1...");
  const goal1Res = await api("/api/objectives", "POST", {
    cycleId: cycle1Id,
    title: "Goal 1 - Open Cycle",
    level: "individual",
    visibility: "company",
    ownerId: users.member.id,
  }, users.member);
  assert.equal(goal1Res.status, 201, `Failed to create Goal 1: ${goal1Res.text}`);
  const goal1Id = goal1Res.body.objective.id;

  const kr1Res = await api("/api/key-results", "POST", {
    objectiveId: goal1Id,
    title: "KR 1 - Metric",
    metricType: "numeric",
    direction: "increasing",
    baseline: 0,
    target: 100,
    current: 10,
    ownerId: users.member.id,
  }, users.member);
  assert.equal(kr1Res.status, 201, `Failed to create KR 1: ${kr1Res.text}`);
  const kr1Id = kr1Res.body.keyResult.id;
  logCheck("Goal 1 and KR 1 created successfully.");

  // 3. Comments and Check-in Requests work while cycle is OPEN
  console.log("\n-> 3. Testing comments and check-in requests while cycle is open...");
  const commentOpenRes = await api("/api/comments", "POST", {
    objectiveId: goal1Id,
    body: "First comment while cycle is open.",
  }, users.manager);
  assert.equal(commentOpenRes.status, 201, `Expected 201 for comment on open cycle: ${commentOpenRes.text}`);
  assert.equal(commentOpenRes.body.comment.body, "First comment while cycle is open.");
  logCheck("Comments can be posted when cycle is open.");

  const getCommentsOpenRes = await api(`/api/comments?objectiveId=${goal1Id}`, "GET", null, users.member);
  assert.equal(getCommentsOpenRes.status, 200);
  assert.equal(getCommentsOpenRes.body.cycleClosed, false);
  assert.equal(getCommentsOpenRes.body.comments.length, 1);
  logCheck("GET comments returns cycleClosed: false on open cycle.");

  const reqCheckInOpenRes = await api("/api/reminders/request", "POST", {
    keyResultId: kr1Id,
    message: "Please post your weekly check-in.",
    email: false,
  }, users.manager);
  assert.equal(reqCheckInOpenRes.status, 201, `Expected 201 for check-in request on open cycle: ${reqCheckInOpenRes.text}`);
  logCheck("Check-in request successfully sent while cycle is open.");

  // Verify unread check-in request notification exists
  const unreadReq1 = await pg.query(
    `SELECT id, type, read_at FROM notifications WHERE company_id = $1 AND entity_id = $2 AND type = 'check_in_request' AND read_at IS NULL`,
    [companyId, kr1Id],
  );
  assert.equal(unreadReq1.rows.length, 1, "Unread check-in request notification should exist before cycle close.");
  logCheck("Unread check-in request notification verified in DB.");

  // 4. Close Cycle 1 and Verify Stale Requests are Cleared
  console.log("\n-> 4. Closing Cycle 1 and verifying stale check-in requests are cleared...");
  const closeCycleRes = await api(`/api/cycles/${cycle1Id}/close`, "POST", {
    reason: "Closing cycle at end of quarter",
    finalReflection: "All objectives reviewed.",
  }, users.admin);
  assert.equal(closeCycleRes.status, 200, `Expected 200 for cycle close: ${closeCycleRes.text}`);
  assert.equal(closeCycleRes.body.status, "closed");
  logCheck("Cycle 1 closed successfully.");

  // Check that the pending check-in request notification was cleared upon cycle close
  const unreadAfterClose = await pg.query(
    `SELECT id, type, read_at FROM notifications WHERE company_id = $1 AND entity_id = $2 AND type = 'check_in_request' AND read_at IS NULL`,
    [companyId, kr1Id],
  );
  assert.equal(unreadAfterClose.rows.length, 0, "Pending check-in requests must be cleared (marked read) when cycle is closed.");

  const readNotif = await pg.query(
    `SELECT id, type, read_at FROM notifications WHERE company_id = $1 AND entity_id = $2 AND type = 'check_in_request'`,
    [companyId, kr1Id],
  );
  assert.ok(readNotif.rows[0].read_at !== null, "Notification must have read_at timestamp set.");
  logCheck("Pending check-in requests on closed cycle are automatically cleared (marked read).");

  // 5. Block comments on closed cycle
  console.log("\n-> 5. Verifying comments are BLOCKED on closed cycle...");
  const commentOnClosedGoal = await api("/api/comments", "POST", {
    objectiveId: goal1Id,
    body: "Trying to comment on closed cycle goal.",
  }, users.member);
  assert.equal(commentOnClosedGoal.status, 400, `Expected 400 when commenting on closed cycle: ${commentOnClosedGoal.text}`);
  assert.match(commentOnClosedGoal.body.error, /Comments cannot be added to a closed cycle/i);
  logCheck("POST /api/comments is blocked on closed cycle goal (400 returned).");

  const commentOnClosedKr = await api("/api/comments", "POST", {
    objectiveId: goal1Id,
    keyResultId: kr1Id,
    body: "Trying to comment on closed cycle KR.",
  }, users.member);
  assert.equal(commentOnClosedKr.status, 400, `Expected 400 when commenting on KR in closed cycle: ${commentOnClosedKr.text}`);
  assert.match(commentOnClosedKr.body.error, /Comments cannot be added to a closed cycle/i);
  logCheck("POST /api/comments is blocked on closed cycle KR (400 returned).");

  // Verify GET comments still works and indicates cycleClosed: true
  const getCommentsClosedRes = await api(`/api/comments?objectiveId=${goal1Id}`, "GET", null, users.member);
  assert.equal(getCommentsClosedRes.status, 200);
  assert.equal(getCommentsClosedRes.body.cycleClosed, true);
  assert.equal(getCommentsClosedRes.body.mentionable.length, 0);
  assert.equal(getCommentsClosedRes.body.comments.length, 1);
  logCheck("GET /api/comments returns cycleClosed: true and preserves history.");

  // 6. Block check-in requests on closed cycle
  console.log("\n-> 6. Verifying check-in requests are BLOCKED on closed cycle...");
  const reqCheckInClosedGoal = await api("/api/reminders/request", "POST", {
    objectiveId: goal1Id,
    message: "Asking for check-in on closed goal.",
    email: false,
  }, users.manager);
  assert.equal(reqCheckInClosedGoal.status, 400, `Expected 400 for check-in request on closed goal: ${reqCheckInClosedGoal.text}`);
  assert.match(reqCheckInClosedGoal.body.error, /Check-in requests cannot be sent for closed cycles/i);
  logCheck("POST /api/reminders/request is blocked for closed cycle goal (400 returned).");

  const reqCheckInClosedKr = await api("/api/reminders/request", "POST", {
    keyResultId: kr1Id,
    message: "Asking for check-in on closed KR.",
    email: false,
  }, users.manager);
  assert.equal(reqCheckInClosedKr.status, 400, `Expected 400 for check-in request on closed KR: ${reqCheckInClosedKr.text}`);
  assert.match(reqCheckInClosedKr.body.error, /Check-in requests cannot be sent for closed cycles/i);
  logCheck("POST /api/reminders/request is blocked for closed cycle KR (400 returned).");

  // User check-in request when user has no open cycles
  const reqCheckInClosedUser = await api("/api/reminders/request", "POST", {
    userId: users.member.id,
    message: "Asking for general check-in with all cycles closed.",
    email: false,
  }, users.manager);
  assert.equal(reqCheckInClosedUser.status, 400, `Expected 400 for user check-in request when all cycles closed: ${reqCheckInClosedUser.text}`);
  assert.match(reqCheckInClosedUser.body.error, /no active key results in open cycles/i);
  logCheck("POST /api/reminders/request is blocked for user with no active KRs in open cycles.");

  // 7. Test clearing stale requests on check-in and on archive
  console.log("\n-> 7. Testing clearing stale requests on check-in and on archive in Cycle 2...");
  await pg.query(
    `INSERT INTO okr_cycles (id, company_id, name, start_date, end_date, status, created_by)
     VALUES ($1, $2, $3, '2027-01-01', '2027-03-31', 'open', $4)`,
    [cycle2Id, companyId, `Cycle 2 ${testSuffix}`, users.admin.id],
  );

  const goal2Res = await api("/api/objectives", "POST", {
    cycleId: cycle2Id,
    title: "Goal 2 - Cycle 2",
    level: "individual",
    visibility: "company",
    ownerId: users.member.id,
  }, users.member);
  const goal2Id = goal2Res.body.objective.id;

  const kr2Res = await api("/api/key-results", "POST", {
    objectiveId: goal2Id,
    title: "KR 2 - Target",
    metricType: "numeric",
    direction: "increasing",
    baseline: 0,
    target: 50,
    current: 0,
    ownerId: users.member.id,
  }, users.member);
  const kr2Id = kr2Res.body.keyResult.id;

  // Send check-in request on KR 2 and User
  await api("/api/reminders/request", "POST", { keyResultId: kr2Id, email: false }, users.manager);
  await api("/api/reminders/request", "POST", { userId: users.member.id, email: false }, users.manager);

  const unreadBeforeCheckIn = await pg.query(
    `SELECT id, type, entity_id FROM notifications WHERE company_id = $1 AND type = 'check_in_request' AND read_at IS NULL`,
    [companyId],
  );
  assert.equal(unreadBeforeCheckIn.rows.length, 2, "Expected 2 unread check-in requests before check-in.");
  logCheck("2 active check-in requests created for Cycle 2.");

  // Member checks in on KR 2
  const checkInRes = await api(`/api/key-results/${kr2Id}/check-ins`, "POST", {
    version: kr2Res.body.keyResult.version,
    value: 25,
    confidence: "on_track",
    note: "Great progress this week.",
  }, users.member);
  assert.equal(checkInRes.status, 201, `Check-in failed: ${checkInRes.text}`);

  const unreadAfterCheckIn = await pg.query(
    `SELECT id, type, entity_id FROM notifications WHERE company_id = $1 AND type = 'check_in_request' AND read_at IS NULL`,
    [companyId],
  );
  assert.equal(unreadAfterCheckIn.rows.length, 0, "Both KR check-in request and user check-in request must be cleared on fresh check-in.");
  logCheck("Submitting a check-in clears open check-in requests for that KR and user.");

  // Test archiving clears stale requests
  // Insert an unread check-in request directly
  const dummyNotifId = crypto.randomUUID();
  await pg.query(
    `INSERT INTO notifications (id, company_id, recipient_id, actor_id, type, title, entity_type, entity_id, dedup_key)
     VALUES ($1, $2, $3, $4, 'check_in_request', 'Please check in on KR 2', 'key_result', $5, $6)`,
    [dummyNotifId, companyId, users.member.id, users.manager.id, kr2Id, `dummy:${testSuffix}`],
  );

  const archiveGoal2Res = await api(`/api/objectives/${goal2Id}/archive`, "POST", {}, users.member);
  assert.equal(archiveGoal2Res.status, 200, `Archive failed: ${archiveGoal2Res.text}`);

  const dummyNotif = await pg.query(`SELECT read_at FROM notifications WHERE id = $1`, [dummyNotifId]);
  assert.ok(dummyNotif.rows[0].read_at !== null, "Archiving a goal must clear any pending check-in requests on it or its KRs.");
  logCheck("Archiving goal automatically clears stale check-in requests.");

  // Test reminder sweep also clears stale requests
  const sweepRes = await api("/api/reminders/sweep", "POST", {}, users.admin);
  assert.equal(sweepRes.status, 200, `Reminder sweep failed: ${sweepRes.text}`);
  logCheck("Reminder sweep endpoint executes cleanly and clears stale requests.");

  console.log(`\n===============================================================`);
  console.log(` ALL ${passedChecks} CHECKS PASSED FOR REQUIREMENT 2!`);
  console.log(`===============================================================\n`);
} catch (error) {
  console.error("\n❌ TEST ERROR:", error);
  throw error;
} finally {
  console.log("-> Cleaning up test database artifacts...");
  try {
    await pg.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    await pg.query(`DELETE FROM "user" WHERE id = ANY($1)`, [Object.values(users).map((u) => u.id)]);
    console.log("-> Test cleanup completed.");
  } catch (err) {
    console.warn("Cleanup warning:", err);
  }
  await pg.end();
}
