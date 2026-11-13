import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as authSchema from "./auth-schema";

export * from "./auth-schema";

export const membershipRole = pgEnum("membership_role", ["admin", "manager", "member"]);
export const cycleStatus = pgEnum("cycle_status", ["draft", "open", "closed"]);
export const keyResultMetric = pgEnum("key_result_metric", ["numeric", "percentage", "currency", "binary"]);
export const metricDirection = pgEnum("metric_direction", ["increasing", "decreasing"]);
export const goalLevel = pgEnum("goal_level", ["company", "team", "individual"]);
export const goalStatus = pgEnum("goal_status", ["draft", "active", "completed", "cancelled"]);
export const approvalStatus = pgEnum("approval_status", ["not_required", "pending", "approved", "changes_requested"]);
export const goalVisibility = pgEnum("goal_visibility", ["company", "team", "restricted"]);
export const confidenceLevel = pgEnum("confidence_level", ["on_track", "at_risk", "off_track"]);
export const checkInCadence = pgEnum("check_in_cadence", ["weekly", "biweekly", "monthly"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "revoked", "expired"]);
export const accessPermission = pgEnum("access_permission", ["viewer", "editor"]);
export const notificationType = pgEnum("notification_type", [
  "invitation",
  "assignment",
  "check_in_request",
  "check_in_cadence",
  "approaching_deadline",
  "overdue_update",
  "mention",
  "approval",
]);
export const deliveryStatus = pgEnum("delivery_status", ["in_app_only", "pending", "sent", "failed"]);

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const companyMemberships = pgTable("company_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: membershipRole("role").default("member").notNull(),
  managerId: text("manager_id").references(() => authSchema.user.id, { onDelete: "set null" }),
  jobTitle: varchar("job_title", { length: 160 }).default("").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_memberships_company_user_unique").on(table.companyId, table.userId),
  index("company_memberships_user_idx").on(table.userId),
  index("company_memberships_company_manager_idx").on(table.companyId, table.managerId),
]);

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description").default("").notNull(),
  leadUserId: text("lead_user_id").references(() => authSchema.user.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("teams_company_name_unique").on(table.companyId, table.name),
]);

export const teamMemberships = pgTable("team_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authSchema.user.id, { onDelete: "cascade" }),
  isLead: boolean("is_lead").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("team_memberships_team_user_unique").on(table.teamId, table.userId),
  index("team_memberships_company_user_idx").on(table.companyId, table.userId),
]);

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 160 }).default("").notNull(),
  role: membershipRole("role").default("member").notNull(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  managerId: text("manager_id").references(() => authSchema.user.id, { onDelete: "set null" }),
  jobTitle: varchar("job_title", { length: 160 }).default("").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  status: invitationStatus("status").default("pending").notNull(),
  invitedBy: text("invited_by").notNull(),
  acceptedBy: text("accepted_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  emailDeliveryStatus: deliveryStatus("email_delivery_status").default("pending").notNull(),
  emailError: text("email_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("invitations_company_email_idx").on(table.companyId, table.email),
  index("invitations_email_status_idx").on(table.email, table.status),
]);

export const okrCycles = pgTable("okr_cycles", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: cycleStatus("status").default("draft").notNull(),
  finalReflection: text("final_reflection").default("").notNull(),
  requireApproval: boolean("require_approval").default(false).notNull(),
  checkInCadence: checkInCadence("check_in_cadence").default("weekly").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").default(1).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("okr_cycles_company_name_unique").on(table.companyId, table.name),
  check("okr_cycles_date_order", sql`${table.startDate} <= ${table.endDate}`),
  index("okr_cycles_company_idx").on(table.companyId),
]);

export const objectives = pgTable("objectives", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").notNull().references(() => okrCycles.id, { onDelete: "restrict" }),
  title: varchar("title", { length: 240 }).notNull(),
  description: text("description").default("").notNull(),
  progress: numeric("progress", { precision: 6, scale: 2 }),
  level: goalLevel("level").default("company").notNull(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => authSchema.user.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  status: goalStatus("status").default("active").notNull(),
  approvalStatus: approvalStatus("approval_status").default("not_required").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  visibility: goalVisibility("visibility").default("company").notNull(),
  parentObjectiveId: uuid("parent_objective_id").references((): AnyPgColumn => objectives.id, { onDelete: "set null" }),
  copiedFromObjectiveId: uuid("copied_from_objective_id").references((): AnyPgColumn => objectives.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").default(1).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("objectives_company_cycle_idx").on(table.companyId, table.cycleId),
  index("objectives_company_owner_idx").on(table.companyId, table.ownerId),
  index("objectives_parent_idx").on(table.parentObjectiveId),
]);

export const objectiveAccess = pgTable("objective_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  objectiveId: uuid("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authSchema.user.id, { onDelete: "cascade" }),
  permission: accessPermission("permission").default("viewer").notNull(),
}, (table) => [
  uniqueIndex("objective_access_objective_user_unique").on(table.objectiveId, table.userId),
]);

export const keyResults = pgTable("key_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  objectiveId: uuid("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 240 }).notNull(),
  metricType: keyResultMetric("metric_type").notNull(),
  direction: metricDirection("direction").notNull(),
  unit: varchar("unit", { length: 24 }).default("").notNull(),
  baseline: numeric("baseline", { precision: 14, scale: 4 }).notNull(),
  target: numeric("target", { precision: 14, scale: 4 }).notNull(),
  current: numeric("current", { precision: 14, scale: 4 }).notNull(),
  progress: numeric("progress", { precision: 6, scale: 2 }).default("0").notNull(),
  ownerId: text("owner_id").references(() => authSchema.user.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  confidence: confidenceLevel("confidence").default("on_track").notNull(),
  lastCheckInAt: timestamp("last_check_in_at", { withTimezone: true }),
  lastEffectiveDate: date("last_effective_date"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("key_results_baseline_target_different", sql`${table.baseline} <> ${table.target}`),
  check("key_results_binary_values", sql`${table.metricType} <> 'binary' OR (${table.baseline} IN (0, 1) AND ${table.target} IN (0, 1) AND ${table.current} IN (0, 1))`),
  index("key_results_company_objective_idx").on(table.companyId, table.objectiveId),
  index("key_results_company_owner_idx").on(table.companyId, table.ownerId),
]);

export const keyResultEditors = pgTable("key_result_editors", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id").notNull().references(() => keyResults.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authSchema.user.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("key_result_editors_key_result_user_unique").on(table.keyResultId, table.userId),
]);

export const krCheckIns = pgTable("kr_check_ins", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").notNull().references(() => okrCycles.id, { onDelete: "restrict" }),
  objectiveId: uuid("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id").notNull().references(() => keyResults.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  effectiveDate: date("effective_date").notNull(),
  value: numeric("value", { precision: 14, scale: 4 }).notNull(),
  progress: numeric("progress", { precision: 6, scale: 2 }).notNull(),
  confidence: confidenceLevel("confidence").default("on_track").notNull(),
  note: text("note").default("").notNull(),
  blockers: text("blockers").default("").notNull(),
  correctsCheckInId: uuid("corrects_check_in_id").references((): AnyPgColumn => krCheckIns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("kr_check_ins_key_result_effective_idx").on(table.keyResultId, table.effectiveDate, table.createdAt),
  index("kr_check_ins_company_cycle_idx").on(table.companyId, table.cycleId),
]);

export const goalComments = pgTable("goal_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  objectiveId: uuid("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id").references(() => keyResults.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  mentions: jsonb("mentions").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("goal_comments_objective_created_idx").on(table.objectiveId, table.createdAt),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id").notNull().references(() => authSchema.user.id, { onDelete: "cascade" }),
  actorId: text("actor_id"),
  type: notificationType("type").notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  body: text("body").default("").notNull(),
  linkPath: varchar("link_path", { length: 500 }),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: text("entity_id"),
  dedupKey: varchar("dedup_key", { length: 240 }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  emailStatus: deliveryStatus("email_status").default("in_app_only").notNull(),
  emailAttempts: integer("email_attempts").default(0).notNull(),
  emailError: text("email_error"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("notifications_company_recipient_dedup_unique").on(table.companyId, table.recipientId, table.dedupKey),
  index("notifications_recipient_created_idx").on(table.recipientId, table.createdAt),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").references(() => okrCycles.id, { onDelete: "set null" }),
  actorId: text("actor_id").notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: text("entity_id"),
  reason: text("reason").notNull(),
  details: jsonb("details").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_logs_company_cycle_created_idx").on(table.companyId, table.cycleId, table.createdAt),
  index("audit_logs_company_entity_idx").on(table.companyId, table.entityType, table.entityId),
]);
