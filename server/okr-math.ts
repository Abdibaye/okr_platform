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
