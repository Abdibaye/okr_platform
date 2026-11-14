export type MetricType = "numeric" | "percentage" | "currency" | "binary";
export type MetricDirection = "increasing" | "decreasing";

export function calculateProgress(
  baseline: number,
  target: number,
  current: number,
  direction: MetricDirection,
  metricType: MetricType,
) {
  if (![baseline, target, current].every(Number.isFinite)) throw new Error("Metric values must be finite numbers");
  if (baseline === target) throw new Error("Baseline and target must be different");
  if (metricType === "binary") {
    if (![baseline, target, current].every((value) => value === 0 || value === 1)) {
      throw new Error("Binary metrics must use 0 or 1");
    }
    return current === target ? 100 : 0;
  }
  if (direction === "increasing" && target < baseline) {
    throw new Error("An increasing metric needs a target above its baseline; choose \"decreasing\" to track a reduction");
  }
  if (direction === "decreasing" && target > baseline) {
    throw new Error("A decreasing metric needs a target below its baseline; choose \"increasing\" to track growth");
  }
  // (current - baseline) / (target - baseline) also covers decreasing metrics (target < baseline): both terms flip sign.
  return Math.min(100, Math.max(0, ((current - baseline) / (target - baseline)) * 100));
}

/** Mean of the given progress values, or null when there is nothing to average (no KRs means no percentage). */
export function averageProgress(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * True when making `candidateParentId` the parent of `objectiveId` would create a loop:
 * self-parenting, or the candidate already descends from the objective (A -> B -> C -> A).
 */
export function wouldCreateAlignmentLoop(
  parentById: Map<string, string | null | undefined>,
  objectiveId: string,
  candidateParentId: string | null | undefined,
) {
  const seen = new Set<string>();
  let current = candidateParentId ?? null;
  while (current) {
    if (current === objectiveId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

/** Start and end ISO dates for a calendar quarter (1–4). */
export function quarterlyPresetDates(year: number, quarter: number) {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) throw new Error("Choose a valid year");
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error("Quarter must be 1, 2, 3 or 4");
  const startMonth = (quarter - 1) * 3;
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, startMonth + 3, 0)).getUTCDate();
  return {
    name: `Q${quarter} ${year}`,
    startDate: `${year}-${pad(startMonth + 1)}-01`,
    endDate: `${year}-${pad(startMonth + 3)}-${pad(lastDay)}`,
  };
}

export interface CycleMetricInput {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "draft" | "open" | "closed";
  finalReflection: string;
  objectives: Array<{
    progress: string | number | null;
    keyResults: Array<{ id: string }>;
  }>;
}

export interface ComputedCycleSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "draft" | "open" | "closed";
  finalReflection: string;
  objectiveCount: number;
  completedObjectives: number;
  keyResultCount: number;
  averageProgress: number | null;
}

export interface ComputedPeriodComparison {
  baseCycleId: string;
  baseCycleName: string;
  targetCycleId: string;
  targetCycleName: string;
  progressDelta: number | null;
  objectiveCountDelta: number;
  completedObjectivesDelta: number;
  keyResultCountDelta: number;
}

function roundTwo(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizeCycle(cycle: CycleMetricInput): ComputedCycleSummary {
  // Objectives without KRs have no percentage, so they are left out of the average.
  const progresses = cycle.objectives
    .filter((objective) => objective.progress !== null && objective.keyResults.length > 0)
    .map((objective) => Number(objective.progress));
  const average = averageProgress(progresses);
  const completedObjectives = progresses.filter((value) => value >= 100).length;
  const keyResultCount = cycle.objectives.reduce((sum, objective) => sum + objective.keyResults.length, 0);
  return {
    id: cycle.id,
    name: cycle.name,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    status: cycle.status,
    finalReflection: cycle.finalReflection,
    objectiveCount: cycle.objectives.length,
    completedObjectives,
    keyResultCount,
    averageProgress: average === null ? null : roundTwo(average),
  };
}

export function compareCycleSummaries(
  base: ComputedCycleSummary,
  target: ComputedCycleSummary,
): ComputedPeriodComparison {
  return {
    baseCycleId: base.id,
    baseCycleName: base.name,
    targetCycleId: target.id,
    targetCycleName: target.name,
    progressDelta: target.averageProgress === null || base.averageProgress === null
      ? null
      : roundTwo(target.averageProgress - base.averageProgress),
    objectiveCountDelta: target.objectiveCount - base.objectiveCount,
    completedObjectivesDelta: target.completedObjectives - base.completedObjectives,
    keyResultCountDelta: target.keyResultCount - base.keyResultCount,
  };
}

export function buildPeriodComparisons(cycles: CycleMetricInput[]) {
  const summaries = cycles
    .map(summarizeCycle)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));

  const comparisons: ComputedPeriodComparison[] = [];
  for (let index = 1; index < summaries.length; index += 1) {
    comparisons.push(compareCycleSummaries(summaries[index - 1], summaries[index]));
  }
  return { summaries, comparisons };
}
