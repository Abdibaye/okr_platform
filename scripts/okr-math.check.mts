// Run: node --experimental-transform-types scripts/okr-math.check.mts
import assert from "node:assert/strict";
import {
  averageProgress,
  calculateProgress,
  quarterlyPresetDates,
  summarizeCycle,
  wouldCreateAlignmentLoop,
} from "../server/okr-math.ts";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
}

check("empty objective has null progress", () => {
  assert.equal(averageProgress([]), null);
  assert.equal(averageProgress([20, 60]), 40);
});

check("cycle summary skips objectives without KRs", () => {
  const summary = summarizeCycle({
    id: "c", name: "Q1", startDate: "2026-01-01", endDate: "2026-03-31", status: "open", finalReflection: "",
    objectives: [{ progress: null, keyResults: [] }, { progress: "50", keyResults: [{ id: "k" }] }],
  });
  assert.equal(summary.averageProgress, 50);
  const empty = summarizeCycle({
    id: "c", name: "Q1", startDate: "2026-01-01", endDate: "2026-03-31", status: "open", finalReflection: "",
    objectives: [{ progress: null, keyResults: [] }],
  });
  assert.equal(empty.averageProgress, null);
});

check("below baseline clamps to 0", () => {
  assert.equal(calculateProgress(10, 20, 5, "increasing", "numeric"), 0);
});

check("exceeded target clamps to 100", () => {
  assert.equal(calculateProgress(0, 100, 150, "increasing", "percentage"), 100);
});

check("partial increasing progress", () => {
  assert.equal(calculateProgress(100, 200, 150, "increasing", "currency"), 50);
});

check("decreasing metric (target below baseline)", () => {
  assert.equal(calculateProgress(100, 50, 75, "decreasing", "numeric"), 50);
  assert.equal(calculateProgress(100, 50, 120, "decreasing", "numeric"), 0);
  assert.equal(calculateProgress(100, 50, 40, "decreasing", "numeric"), 100);
});

check("direction must match target vs baseline", () => {
  assert.throws(() => calculateProgress(100, 50, 75, "increasing", "numeric"), /increasing metric/);
  assert.throws(() => calculateProgress(0, 10, 5, "decreasing", "numeric"), /decreasing metric/);
});

check("binary is strictly 0 or 100", () => {
  assert.equal(calculateProgress(0, 1, 0, "increasing", "binary"), 0);
  assert.equal(calculateProgress(0, 1, 1, "increasing", "binary"), 100);
  assert.equal(calculateProgress(1, 0, 0, "decreasing", "binary"), 100);
  assert.throws(() => calculateProgress(0, 1, 0.5, "increasing", "binary"), /0 or 1/);
  assert.throws(() => calculateProgress(0, 2, 1, "increasing", "binary"), /0 or 1/);
});

check("baseline equal to target is rejected", () => {
  assert.throws(() => calculateProgress(5, 5, 5, "increasing", "numeric"), /different/);
});

check("alignment loops are rejected", () => {
  // A -> B -> C (C's parent is B, B's parent is A)
  const parents = new Map<string, string | null>([["A", null], ["B", "A"], ["C", "B"]]);
  assert.equal(wouldCreateAlignmentLoop(parents, "A", "A"), true, "self parent");
  assert.equal(wouldCreateAlignmentLoop(parents, "A", "C"), true, "A -> C would close A -> B -> C -> A");
  assert.equal(wouldCreateAlignmentLoop(parents, "C", "A"), false, "re-parenting C under A is fine");
  assert.equal(wouldCreateAlignmentLoop(parents, "D", "C"), false, "new child under C is fine");
  assert.equal(wouldCreateAlignmentLoop(parents, "A", null), false, "clearing parent is fine");
});

check("quarterly presets", () => {
  assert.deepEqual(quarterlyPresetDates(2026, 1), { name: "Q1 2026", startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.deepEqual(quarterlyPresetDates(2026, 2), { name: "Q2 2026", startDate: "2026-04-01", endDate: "2026-06-30" });
  assert.deepEqual(quarterlyPresetDates(2026, 3), { name: "Q3 2026", startDate: "2026-07-01", endDate: "2026-09-30" });
  assert.deepEqual(quarterlyPresetDates(2026, 4), { name: "Q4 2026", startDate: "2026-10-01", endDate: "2026-12-31" });
  assert.throws(() => quarterlyPresetDates(2026, 5), /Quarter/);
});

console.log(`\n${passed} checks passed`);
