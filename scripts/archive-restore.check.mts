// Run: pnpm run check:archive-restore
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../server/db.ts";
import {
  archiveObjectiveAndKeyResults,
  restoreObjectiveAndKeyResults,
} from "../server/archive.ts";
import {
  companies,
  companyMemberships,
  keyResultEditors,
  keyResults,
  krCheckIns,
  objectiveAccess,
  objectives,
  okrCycles,
  user,
} from "../server/schema.ts";

const database = getDb();
const runId = randomUUID();
const companyId = process.env.ARCHIVE_RESTORE_COMPANY_ID ?? randomUUID();
const ownerId = `test-user-${runId}`;
const otherUserId = `test-user-other-${runId}`;
let passed = 0;
function check(name: string, run: () => void | Promise<void>) {
  return Promise.resolve(run()).then(() => {
    passed += 1;
    console.log(`ok - ${name}`);
  });
}

type UserRow = typeof user.$inferSelect;

async function cleanup() {
  if (!companyId) return;
  await database.delete(companies).where(eq(companies.id, companyId));
  await database.delete(user).where(inArray(user.id, [ownerId, otherUserId]));
}

async function snapshotRows() {
  const [objectiveRows, krRows, checkInRows, accessRows, editorRows] = await Promise.all([
    database.select().from(objectives).where(eq(objectives.companyId, companyId)),
    database.select().from(keyResults).where(eq(keyResults.companyId, companyId)),
    database.select().from(krCheckIns).where(eq(krCheckIns.companyId, companyId)),
    database.select().from(objectiveAccess).where(eq(objectiveAccess.companyId, companyId)),
    database.select().from(keyResultEditors).where(eq(keyResultEditors.companyId, companyId)),
  ]);
  return { objectiveRows, krRows, checkInRows, accessRows, editorRows };
}

function normalizeCheckIns(rows: Awaited<ReturnType<typeof snapshotRows>>["checkInRows"]) {
  return rows.map((row) => ({ ...row }));
}

const users: UserRow[] = [
  { id: ownerId, name: "Archive Restore Owner", email: `owner-${runId}@example.test`, emailVerified: true, image: null, createdAt: new Date(), updatedAt: new Date() },
  { id: otherUserId, name: "Archive Restore Viewer", email: `viewer-${runId}@example.test`, emailVerified: true, image: null, createdAt: new Date(), updatedAt: new Date() },
];

try {
  const [company] = await database.insert(companies).values({ id: companyId, name: `Archive restore check ${runId}` }).returning();
  assert.ok(company);
  await database.insert(user).values(users);
  await database.insert(companyMemberships).values([
    { companyId, userId: ownerId, role: "admin", managerId: null, jobTitle: "Check owner", isActive: true },
    { companyId, userId: otherUserId, role: "member", managerId: ownerId, jobTitle: "Check viewer", isActive: true },
  ]);
  const cycle = await database.insert(okrCycles).values({
    companyId, name: `Restore check ${runId}`, startDate: "2026-01-01", endDate: "2026-12-31",
    status: "open", requireApproval: false, createdBy: ownerId,
  }).returning();
  assert.equal(cycle.length, 1);

  const firstGoal = await database.insert(objectives).values({
    companyId, cycleId: cycle[0].id, title: `Restorable goal ${runId}`, level: "individual",
    ownerId, status: "active", visibility: "restricted", createdBy: ownerId,
  }).returning();
  const secondGoal = await database.insert(objectives).values({
    companyId, cycleId: cycle[0].id, title: `Guard goal ${runId}`, level: "individual",
    ownerId, status: "active", visibility: "restricted", createdBy: ownerId,
  }).returning();

  const firstKrs = await database.insert(keyResults).values([
    { companyId, objectiveId: firstGoal[0].id, title: `First KR ${runId}`, metricType: "numeric", direction: "increasing", baseline: "0", target: "100", current: "25", progress: "25", ownerId },
    { companyId, objectiveId: firstGoal[0].id, title: `Second KR ${runId}`, metricType: "numeric", direction: "increasing", baseline: "0", target: "50", current: "10", progress: "20", ownerId },
  ]).returning();
  const guardKrs = await database.insert(keyResults).values([
    { companyId, objectiveId: secondGoal[0].id, title: `Guard KR ${runId}`, metricType: "numeric", direction: "increasing", baseline: "0", target: "20", current: "10", progress: "50", ownerId, archivedAt: new Date() },
  ]).returning();

  await database.insert(keyResultEditors).values({ companyId, keyResultId: firstKrs[0].id, userId: otherUserId });
  const checkIns = await database.insert(krCheckIns).values([
    { companyId, cycleId: cycle[0].id, objectiveId: firstGoal[0].id, keyResultId: firstKrs[0].id, authorId: ownerId, effectiveDate: "2026-01-10", value: "10", progress: "10", confidence: "on_track", note: "original note", blockers: "original blocker" },
    { companyId, cycleId: cycle[0].id, objectiveId: firstGoal[0].id, keyResultId: firstKrs[1].id, authorId: ownerId, effectiveDate: "2026-01-11", value: "5", progress: "10", confidence: "at_risk", note: "second note", blockers: "" },
  ]).returning();
  await database.insert(objectiveAccess).values({ companyId, objectiveId: firstGoal[0].id, userId: otherUserId, permission: "editor" });

  const before = await snapshotRows();
  assert.equal(before.objectiveRows.length, 2);
  assert.equal(before.krRows.length, 3);
  assert.equal(before.checkInRows.length, 2);
  assert.equal(before.accessRows.length, 1);
  assert.equal(before.editorRows.length, 1);
  const checkInsBefore = normalizeCheckIns(before.checkInRows);

  await check("archive goal and its KRs", async () => {
    await database.transaction(async (transaction) => archiveObjectiveAndKeyResults(transaction, firstGoal[0].id));
    const rows = await snapshotRows();
    assert.equal(rows.objectiveRows.find((row) => row.id === firstGoal[0].id)?.archivedAt !== null, true);
    assert.deepEqual(rows.krRows.filter((row) => row.objectiveId === firstGoal[0].id).map((row) => row.archivedAt !== null), [true, true]);
  });

  const afterArchive = await snapshotRows();
  await check("restore returns the same goal and KRs while preserving history and permissions", async () => {
    await database.transaction(async (transaction) => restoreObjectiveAndKeyResults(transaction, firstGoal[0].id));
    const restored = await snapshotRows();
    const restoredObjective = restored.objectiveRows.find((row) => row.id === firstGoal[0].id);
    assert.equal(restoredObjective?.archivedAt, null);
    assert.deepEqual(restored.krRows.filter((row) => row.objectiveId === firstGoal[0].id).map((row) => row.id), firstKrs.map((row) => row.id));
    assert.deepEqual(restored.krRows.filter((row) => row.objectiveId === firstGoal[0].id).map((row) => [row.id, row.archivedAt]), firstKrs.map((row) => [row.id, null]));
    assert.deepEqual(restored.checkInRows, checkInsBefore);
    assert.deepEqual(restored.accessRows, afterArchive.accessRows);
    assert.deepEqual(restored.editorRows, afterArchive.editorRows);
    assert.equal(restored.objectiveRows.find((row) => row.id === firstGoal[0].id)?.ownerId, ownerId);
    assert.equal(restored.krRows.find((row) => row.id === firstKrs[0].id)?.ownerId, ownerId);
    const byId = (rows: Array<{ id: string; ownerId: string | null }>) => new Map(rows.map((row) => [row.id, row.ownerId]));
    assert.deepEqual(byId(restored.objectiveRows), byId(before.objectiveRows));
    assert.deepEqual(byId(restored.krRows), byId(before.krRows));
  });

  await check("restore does not unarchive another goal's KR", () => {
    const otherKr = afterArchive.krRows.find((row) => row.id === guardKrs[0].id);
    assert.notEqual(otherKr?.archivedAt, null);
  });

  const beforeActiveRestore = await snapshotRows();
  await check("restoring an active goal changes no unintended rows", async () => {
    await database.transaction(async (transaction) => restoreObjectiveAndKeyResults(transaction, secondGoal[0].id));
    const afterActiveRestore = await snapshotRows();
    const excluded = ["updatedAt"];
    const strip = (rows: Record<string, unknown>[]) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.includes(key))));
    assert.deepEqual(afterActiveRestore.objectiveRows.map((row) => strip([row])[0]), beforeActiveRestore.objectiveRows.map((row) => strip([row])[0]));
    assert.deepEqual(strip(afterActiveRestore.krRows), strip(beforeActiveRestore.krRows));
    assert.deepEqual(afterActiveRestore.checkInRows, checkInsBefore);
    assert.deepEqual(afterActiveRestore.accessRows, beforeActiveRestore.accessRows);
    assert.deepEqual(afterActiveRestore.editorRows, beforeActiveRestore.editorRows);
  });

  console.log(`\n${passed} checks passed`);
} finally {
  await cleanup();
}
