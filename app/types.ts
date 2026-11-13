export type Role = "admin" | "manager" | "member";

export type CycleStatus = "draft" | "open" | "closed";

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
}

export interface CycleSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: CycleStatus;
  finalReflection: string;
  objectiveCount: number;
  completedObjectives: number;
  keyResultCount: number;
  averageProgress: number;
}

export interface PeriodComparison {
  baseCycleId: string;
  baseCycleName: string;
  targetCycleId: string;
  targetCycleName: string;
  progressDelta: number;
  objectiveCountDelta: number;
  completedObjectivesDelta: number;
  keyResultCountDelta: number;
}

export interface Workspace {
  user: WorkspaceUser;
  company: { id: string; name: string; role: Role };
  cycles: Cycle[];
  summaries: CycleSummary[];
  comparisons: PeriodComparison[];
  audit: AuditLog[];
}

export interface Cycle {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: CycleStatus;
  finalReflection: string;
  version: number;
  objectives: Objective[];
}

export interface Objective {
  id: string;
  title: string;
  description: string;
  progress: string | null;
  version: number;
  keyResults: KeyResult[];
}

export interface KeyResult {
  id: string;
  title: string;
  metricType: "numeric" | "percentage" | "currency" | "binary";
  direction: "increasing" | "decreasing";
  unit: string;
  baseline: string;
  target: string;
  current: string;
  progress: string;
  version: number;
}

export interface AuditLog {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
}
