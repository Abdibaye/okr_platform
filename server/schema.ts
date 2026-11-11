import {
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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as authSchema from "./auth-schema";

export * from "./auth-schema";

export const membershipRole = pgEnum("membership_role", ["admin", "manager", "member"]);
export const cycleStatus = pgEnum("cycle_status", ["draft", "open", "closed"]);
export const keyResultMetric = pgEnum("key_result_metric", ["numeric", "percentage", "currency", "binary"]);
export const metricDirection = pgEnum("metric_direction", ["increasing", "decreasing"]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_memberships_company_user_unique").on(table.companyId, table.userId),
  index("company_memberships_user_idx").on(table.userId),
]);

export const okrCycles = pgTable("okr_cycles", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: cycleStatus("status").default("draft").notNull(),
  finalReflection: text("final_reflection").default("").notNull(),
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
  progress: numeric("progress", { precision: 6, scale: 2 }).default("0").notNull(),
  version: integer("version").default(1).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("objectives_company_cycle_idx").on(table.companyId, table.cycleId),
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
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("key_results_baseline_target_different", sql`${table.baseline} <> ${table.target}`),
  check("key_results_binary_values", sql`${table.metricType} <> 'binary' OR (${table.baseline} IN (0, 1) AND ${table.target} IN (0, 1) AND ${table.current} IN (0, 1))`),
  index("key_results_company_objective_idx").on(table.companyId, table.objectiveId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").notNull().references(() => okrCycles.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  reason: text("reason").notNull(),
  details: jsonb("details").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("audit_logs_company_cycle_created_idx").on(table.companyId, table.cycleId, table.createdAt)]);
