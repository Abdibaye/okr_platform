import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { CsvParseError, parseCsv } from "./csv";
import { calculateProgress } from "./okr-math";
import { companyMemberships, keyResults, objectives, okrCycles, teams, user } from "./schema";

export const OKR_CSV_HEADERS = [
  "cycle_name", "objective_title", "objective_description", "level", "team_name", "owner_email", "due_date",
  "visibility", "parent_objective_title", "kr_title", "metric_type", "direction", "baseline", "target", "current", "unit",
] as const;

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportPlan {
  cycleId: string;
  cycleName: string;
  objectiveTitle: string;
  objectiveDescription: string;
  level: "company" | "team" | "individual";
  teamName: string;
  teamId: string | null;
  ownerId: string;
  ownerEmail: string;
  dueDate: string | null;
  visibility: "company" | "team" | "restricted";
  parentTitle: string | null;
  parentObjectiveId: string | null;
  krTitle: string;
  metricType: "numeric" | "percentage" | "currency" | "binary";
  direction: "increasing" | "decreasing";
  baseline: number;
  target: number;
  current: number;
  unit: string;
}

const METRIC_TYPES = new Set(["numeric", "percentage", "currency", "binary"]);
const DIRECTIONS = new Set(["increasing", "decreasing"]);
const LEVELS = new Set(["company", "team", "individual"]);
const VISIBILITIES = new Set(["company", "team", "restricted"]);

export interface OkrImportResult {
  errors: ImportRowError[];
  plannedObjectives: number;
  plannedKeyResults: number;
  plans: ImportPlan[];
}

export async function validateOkrCsv(companyId: string, csv: string): Promise<OkrImportResult> {
  let records;
  try {
    records = parseCsv(csv);
  } catch (error) {
    const line = error instanceof CsvParseError ? error.line : 1;
    const reason = error instanceof Error ? error.message : "Malformed CSV";
    return { errors: [{ row: line, reason }], plannedObjectives: 0, plannedKeyResults: 0, plans: [] };
  }
  const errors: ImportRowError[] = [];
  if (!records.length) return { errors: [{ row: 1, reason: "CSV is empty" }], plannedObjectives: 0, plannedKeyResults: 0, plans: [] };
  const header = records[0].fields.map((field) => field.trim().toLowerCase());
  for (const required of OKR_CSV_HEADERS) {
    if (!header.includes(required)) errors.push({ row: 1, reason: `Missing required column "${required}"` });
  }
  if (errors.length) return { errors, plannedObjectives: 0, plannedKeyResults: 0, plans: [] };

  const database = getDb();
  const [cycleRows, teamRows, memberRows, existingObjectiveRows] = await Promise.all([
    database.select().from(okrCycles).where(eq(okrCycles.companyId, companyId)),
    database.select().from(teams).where(eq(teams.companyId, companyId)),
    database.select({ userId: companyMemberships.userId, email: user.email })
      .from(companyMemberships).innerJoin(user, eq(user.id, companyMemberships.userId))
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.isActive, true))),
    database.select({ id: objectives.id, title: objectives.title, parentId: objectives.parentObjectiveId })
      .from(objectives).where(eq(objectives.companyId, companyId)),
  ]);
  const cycleByName = new Map(cycleRows.map((cycle) => [cycle.name.toLowerCase(), cycle]));
  const teamByName = new Map(teamRows.map((team) => [team.name.toLowerCase(), team]));
  const memberByEmail = new Map(memberRows.map((member) => [member.email.toLowerCase(), member]));
  const plans: ImportPlan[] = [];
  const plannedTitles = new Set<string>();

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;
    if (record.fields.every((field) => field.trim() === "")) continue;
    const values = Object.fromEntries(OKR_CSV_HEADERS.map((name, position) => [name, record.fields[position]?.trim() ?? ""])) as Record<(typeof OKR_CSV_HEADERS)[number], string>;
    const rowErrors: string[] = [];
    const cycle = cycleByName.get(values.cycle_name.toLowerCase());
    if (!cycle) rowErrors.push(`Unknown cycle "${values.cycle_name}"`);
    else if (cycle.status === "closed") rowErrors.push(`Cycle "${cycle.name}" is closed`);
    if (!values.objective_title) rowErrors.push("Objective title is required");
    if (!LEVELS.has(values.level)) rowErrors.push(`Invalid level "${values.level}"`);
    if (!VISIBILITIES.has(values.visibility)) rowErrors.push(`Invalid visibility "${values.visibility}"`);
    const owner = memberByEmail.get(values.owner_email.toLowerCase());
    if (!owner) rowErrors.push(`Unknown owner "${values.owner_email}"`);
    const team = values.team_name ? teamByName.get(values.team_name.toLowerCase()) : undefined;
    if (values.team_name && !team) rowErrors.push(`Unknown team "${values.team_name}"`);
    if (values.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(values.due_date)) rowErrors.push(`Invalid due date "${values.due_date}"`);
    if (!METRIC_TYPES.has(values.metric_type)) rowErrors.push(`Invalid metric type "${values.metric_type}"`);
    if (!DIRECTIONS.has(values.direction)) rowErrors.push(`Invalid direction "${values.direction}"`);
    const baseline = Number(values.baseline);
    const target = Number(values.target);
    const current = Number(values.current);
    if (!Number.isFinite(baseline) || !Number.isFinite(target) || !Number.isFinite(current)) rowErrors.push("Baseline, target and current must be numbers");
    else {
      if (baseline === target) rowErrors.push("Baseline must differ from target");
      if (values.metric_type === "binary" && ![0, 1].includes(baseline)) rowErrors.push("Binary baseline must be 0 or 1");
      if (values.metric_type === "binary" && ![0, 1].includes(target)) rowErrors.push("Binary target must be 0 or 1");
      if (values.metric_type === "binary" && ![0, 1].includes(current)) rowErrors.push("Binary current must be 0 or 1");
    }
    if (rowErrors.length) {
      errors.push(...rowErrors.map((reason) => ({ row: rowNumber, reason })));
      continue;
    }
    let parentObjectiveId: string | null = null;
    if (values.parent_objective_title) {
      if (values.parent_objective_title.toLowerCase() === values.objective_title.toLowerCase()) {
        rowErrors.push("Goal cannot align to itself");
      } else if (plannedTitles.has(values.parent_objective_title.toLowerCase())) {
        rowErrors.push("Parent goal must already exist before it can be referenced");
      } else {
        const parent = existingObjectiveRows.find((row) => row.title.toLowerCase() === values.parent_objective_title.toLowerCase());
        if (!parent) rowErrors.push(`Parent objective "${values.parent_objective_title}" does not exist`);
        else parentObjectiveId = parent.id;
      }
    }
    if (rowErrors.length) {
      errors.push(...rowErrors.map((reason) => ({ row: rowNumber, reason })));
      continue;
    }
    plannedTitles.add(values.objective_title.toLowerCase());
    plans.push({
      cycleId: cycle!.id,
      cycleName: cycle!.name,
      objectiveTitle: values.objective_title,
      objectiveDescription: values.objective_description,
      level: values.level as ImportPlan["level"],
      teamName: values.team_name,
      teamId: team?.id ?? null,
      ownerId: owner!.userId,
      ownerEmail: values.owner_email,
      dueDate: values.due_date || null,
      visibility: values.visibility as ImportPlan["visibility"],
      parentTitle: values.parent_objective_title || null,
      parentObjectiveId,
      krTitle: values.kr_title,
      metricType: values.metric_type as ImportPlan["metricType"],
      direction: values.direction as ImportPlan["direction"],
      baseline, target, current,
      unit: values.unit,
    });
  }
  return { errors, plannedObjectives: new Set(plans.map((plan) => plan.objectiveTitle.toLowerCase())).size, plannedKeyResults: plans.length, plans };
}
