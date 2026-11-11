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
  if (metricType === "binary" && ![baseline, target, current].every((value) => value === 0 || value === 1)) {
    throw new Error("Binary metrics must use 0 or 1");
  }
  const denominator = direction === "increasing" ? target - baseline : baseline - target;
  const numerator = direction === "increasing" ? current - baseline : baseline - current;
  return Math.min(100, Math.max(0, (numerator / denominator) * 100));
}

export function averageProgress(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface CycleMetricInput {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "draft" | "open" | "closed";
  finalReflection: string;
  objectives: Array<{
    progress: string | number;
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
  averageProgress: number;
}

export interface ComputedPeriodComparison {
  baseCycleId: string;
  baseCycleName: string;
  targetCycleId: string;
  targetCycleName: string;
  progressDelta: number;
  objectiveCountDelta: number;
  completedObjectivesDelta: number;
  keyResultCountDelta: number;
}

function roundTwo(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizeCycle(cycle: CycleMetricInput): ComputedCycleSummary {
  const progresses = cycle.objectives.map((objective) => Number(objective.progress) || 0);
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
    averageProgress: roundTwo(averageProgress(progresses)),
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
    progressDelta: roundTwo(target.averageProgress - base.averageProgress),
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
