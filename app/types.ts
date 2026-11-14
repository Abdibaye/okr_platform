export type Role = "admin" | "manager" | "member";

export type CycleStatus = "draft" | "open" | "closed";

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  managerId: string | null;
  teamIds: string[];
  directReportIds: string[];
}

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  managerId: string | null;
  isActive: boolean;
  teamIds: string[];
}

export interface WorkspaceTeam {
  id: string;
  name: string;
}

export interface PersonSummary {
  id: string;
  name: string;
  jobTitle: string;
}

export type GoalLevel = "company" | "team" | "individual";
export type GoalStatus = "draft" | "active" | "completed" | "cancelled";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "changes_requested";
export type GoalVisibility = "company" | "team" | "restricted";
export type CheckInCadence = "weekly" | "biweekly" | "monthly";

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
  averageProgress: number | null;
}

export interface PeriodComparison {
  baseCycleId: string;
  baseCycleName: string;
  targetCycleId: string;
  targetCycleName: string;
  progressDelta: number | null;
  objectiveCountDelta: number;
  completedObjectivesDelta: number;
  keyResultCountDelta: number;
}

export interface Workspace {
  user: WorkspaceUser;
  company: { id: string; name: string; role: Role };
  members: WorkspaceMember[];
  teams: WorkspaceTeam[];
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
  requireApproval: boolean;
  checkInCadence: CheckInCadence;
  version: number;
  objectives: Objective[];
}

export interface Objective {
  id: string;
  cycleId: string;
  title: string;
  description: string;
  progress: string | null;
  level: GoalLevel;
  teamId: string | null;
  team: WorkspaceTeam | null;
  ownerId: string | null;
  owner: PersonSummary | null;
  dueDate: string | null;
  status: GoalStatus;
  approvalStatus: ApprovalStatus;
  visibility: GoalVisibility;
  parentObjectiveId: string | null;
  copiedFromObjectiveId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  access: { userId: string; permission: "viewer" | "editor" }[];
  canEdit: boolean;
  canManage: boolean;
  canApprove: boolean;
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
  ownerId: string | null;
  owner: PersonSummary | null;
  dueDate: string | null;
  editorIds: string[];
  canCheckIn: boolean;
  updatedAt: string;
  version: number;
}

export interface AuditLog {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
}
