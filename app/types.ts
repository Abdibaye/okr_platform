export type Role = "admin" | "manager" | "member";

export type CycleStatus = "draft" | "open" | "closed";

export interface WorkspaceUser {
  name: string;
  email: string;
}

export interface Workspace {
  user: WorkspaceUser;
  company: { id: string; name: string; role: Role };
  cycles: Cycle[];
  audit: AuditLog[];
}

export interface Cycle {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: CycleStatus;
  finalReflection: string;
  objectives: Objective[];
}

export interface Objective {
  id: string;
  title: string;
  description: string;
  progress: string;
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
}

export interface AuditLog {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
}
