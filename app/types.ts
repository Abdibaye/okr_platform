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
  archivedAt: string | null;
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
  confidence: Confidence;
  lastEffectiveDate: string | null;
  lastCheckInAt: string | null;
  updatedAt: string;
  version: number;
}

export type Confidence = "on_track" | "at_risk" | "off_track";

/** One immutable entry in a key result's check-in ledger, as returned by GET /api/key-results/[id]/check-ins. */
export interface CheckInEntry {
  id: string;
  authorId: string;
  authorName: string;
  effectiveDate: string;
  value: string;
  progress: string;
  confidence: Confidence;
  note: string;
  blockers: string;
  correctsCheckInId: string | null;
  supersededById: string | null;
  isSuperseded: boolean;
  isCurrentEffective: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
}

export type EmailStatus = "in_app_only" | "pending" | "sent" | "failed";

export interface AppNotification {
  id: string;
  type: "invitation" | "assignment" | "check_in_request" | "check_in_cadence" | "approaching_deadline" | "overdue_update" | "mention" | "approval";
  title: string;
  body: string;
  linkPath: string | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
  emailStatus: EmailStatus;
  emailError: string | null;
  emailAttempts: number;
  lastAttemptAt: string | null;
}

export interface GoalComment {
  id: string;
  keyResultId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  mentions: { id: string; name: string }[];
  createdAt: string;
}
