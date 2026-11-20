import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { keyResultEditors, keyResults, krCheckIns, objectives, okrCycles, user } from "@/server/schema";
import { calculateProgress, compareCheckInsNewestFirst, selectEffectiveCheckIn } from "@/server/okr-math";
import { recomputeKeyResultFromCheckIns, refreshObjectiveProgress, todayWithinCycle } from "@/server/okr-mutations";
import {
  canEditKeyResult,
  canViewObjective,
  InputError,
  isIsoDate,
  loadObjectiveAccessFacts,
  viewerFromContext,
} from "@/server/objectives";
import type { RequestContext } from "@/server/request-context";
import { resolveNotifications } from "@/server/notifications";
import type { Transaction } from "@/server/people";

const CONFIDENCE = ["on_track", "at_risk", "off_track"] as const;
type Confidence = (typeof CONFIDENCE)[number];
const NOT_FOUND = "Key result not found in this workspace.";

/** Loads a visible, non-archived key result with its goal and cycle; 404s when the viewer can't see it. */
async function loadVisibleKeyResult(executor: ReturnType<typeof getDb> | Transaction, context: RequestContext, id: string, lock: boolean) {
  const query = executor.select({ keyResult: keyResults, objective: objectives, cycle: okrCycles })
    .from(keyResults)
    .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, context.companyId)))
    .innerJoin(okrCycles, eq(okrCycles.id, objectives.cycleId))
    .where(and(
      eq(keyResults.id, id),
      eq(keyResults.companyId, context.companyId),
      isNull(keyResults.archivedAt),
      isNull(objectives.archivedAt),
    ));
  const [row] = lock ? await query.for("update", { of: keyResults }).limit(1) : await query.limit(1);
  if (!row) throw new InputError(NOT_FOUND, 404);
  const facts = await loadObjectiveAccessFacts(executor, context.companyId, row.objective.id, row.objective.ownerId);
  if (!canViewObjective(row.objective, viewerFromContext(context), facts)) {
    throw new InputError(NOT_FOUND, 404);
  }
  return { ...row, facts };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse(NOT_FOUND, 404);

  try {
    const database = getDb();
    await loadVisibleKeyResult(database, context, id, false);
    const rows = await database.select({ checkIn: krCheckIns, authorName: user.name })
      .from(krCheckIns)
      .leftJoin(user, eq(user.id, krCheckIns.authorId))
      .where(and(eq(krCheckIns.keyResultId, id), eq(krCheckIns.companyId, context.companyId)));
    const history = rows.map((row) => row.checkIn);
    const effectiveId = selectEffectiveCheckIn(history)?.id ?? null;
    const supersededBy = new Map(history.filter((entry) => entry.correctsCheckInId).map((entry) => [entry.correctsCheckInId!, entry.id]));
    const checkIns = rows
      .sort((a, b) => compareCheckInsNewestFirst(a.checkIn, b.checkIn))
      .map(({ checkIn, authorName }) => ({
        id: checkIn.id,
        authorId: checkIn.authorId,
        authorName: authorName ?? "Former member",
        effectiveDate: checkIn.effectiveDate,
        value: checkIn.value,
        progress: checkIn.progress,
        confidence: checkIn.confidence,
        note: checkIn.note,
        blockers: checkIn.blockers,
        correctsCheckInId: checkIn.correctsCheckInId,
        supersededById: supersededBy.get(checkIn.id) ?? null,
        isSuperseded: supersededBy.has(checkIn.id),
        isCurrentEffective: checkIn.id === effectiveId,
        createdAt: checkIn.createdAt,
      }));
    return NextResponse.json({ checkIns });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}

function text(value: unknown, label: string, max: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.trim().length > max) throw new InputError(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse(NOT_FOUND, 404);

  const body = await readJson(request);
  const version = typeof body?.version === "number" ? body.version : undefined;
  if (!body || !Number.isSafeInteger(version) || (version as number) < 1) {
    return errorResponse("Include the current key result version to save your check-in.", 400);
  }

  const actorId = context.session.user.id;
  const viewer = viewerFromContext(context);
  try {
    if (typeof body.value !== "number" || !Number.isFinite(body.value) || Math.abs(body.value) >= 1e10) {
      throw new InputError("Provide a valid value for this check-in.");
    }
    const value = body.value;
    if (body.effectiveDate !== undefined && body.effectiveDate !== null && body.effectiveDate !== "" && !isIsoDate(body.effectiveDate)) {
      throw new InputError("Effective date must be a valid date (YYYY-MM-DD).");
    }
    const requestedDate = typeof body.effectiveDate === "string" && body.effectiveDate ? body.effectiveDate : null;
    if (body.confidence !== undefined && !(CONFIDENCE as readonly unknown[]).includes(body.confidence)) {
      throw new InputError("Choose a valid confidence level.");
    }
    const confidence = (body.confidence ?? "on_track") as Confidence;
    const note = text(body.note, "Note", 2000);
    const blockers = text(body.blockers, "Blockers", 2000);
    const correctsCheckInId = body.correctsCheckInId === undefined || body.correctsCheckInId === null || body.correctsCheckInId === ""
      ? null
      : body.correctsCheckInId;
    if (correctsCheckInId !== null && (typeof correctsCheckInId !== "string" || !isUuid(correctsCheckInId))) {
      throw new InputError("Choose a valid check-in to correct.");
    }

    const result = await getDb().transaction(async (transaction) => {
      const { keyResult, objective, cycle, facts } = await loadVisibleKeyResult(transaction, context, id, true);
      if (cycle.status === "closed") throw new InputError("This cycle is closed; check-ins are locked.", 403);
      if (cycle.status !== "open") throw new InputError("Open the cycle before checking in on key results.", 403);

      const krEditors = await transaction.select({ userId: keyResultEditors.userId }).from(keyResultEditors)
        .where(eq(keyResultEditors.keyResultId, id));
      const canCheckIn = canEditKeyResult(objective, keyResult, viewer, facts, krEditors.map((editor) => editor.userId));
      if (!canCheckIn) throw new InputError("Only the key result owner, its editors, goal owners and editors, managers and admins can check in.", 403);
      if (keyResult.version !== version) {
        throw new InputError("Someone else updated this key result — refresh and try again.", 409);
      }

      const effectiveDate = requestedDate ?? todayWithinCycle(cycle);
      if (effectiveDate < cycle.startDate || effectiveDate > cycle.endDate) {
        throw new InputError(`Effective date must fall within the cycle (${cycle.startDate} to ${cycle.endDate}).`);
      }

      if (correctsCheckInId) {
        const history = await transaction.select({ id: krCheckIns.id, correctsCheckInId: krCheckIns.correctsCheckInId }).from(krCheckIns)
          .where(and(eq(krCheckIns.keyResultId, id), eq(krCheckIns.companyId, context.companyId)));
        if (!history.some((entry) => entry.id === correctsCheckInId)) throw new InputError("The check-in being corrected belongs to a different key result.");
        if (history.some((entry) => entry.correctsCheckInId === correctsCheckInId)) {
          throw new InputError("That check-in has already been corrected. Correct the newer entry instead.");
        }
        // The new row is not referenced by anything yet, so linking it to an existing entry cannot form a loop.
      }

      let progress: number;
      try {
        progress = calculateProgress(Number(keyResult.baseline), Number(keyResult.target), value, keyResult.direction, keyResult.metricType);
      } catch (error) {
        throw new InputError(error instanceof Error ? error.message : "Invalid check-in value.");
      }

      const [checkIn] = await transaction.insert(krCheckIns).values({
        companyId: context.companyId,
        cycleId: cycle.id,
        objectiveId: objective.id,
        keyResultId: id,
        authorId: actorId,
        effectiveDate,
        value: value.toString(),
        progress: progress.toFixed(2),
        confidence,
        note,
        blockers,
        correctsCheckInId,
      }).returning();
      const recomputed = await recomputeKeyResultFromCheckIns(transaction, id, context.companyId, keyResult.version);
      await refreshObjectiveProgress(transaction, objective.id, context.companyId);
      // A fresh check-in answers any open "please check in" nudges for this key result.
      await resolveNotifications(transaction, context.companyId, id, ["check_in_cadence", "check_in_request"]);
      await resolveNotifications(transaction, context.companyId, objective.id, ["check_in_request"]);
      await resolveNotifications(transaction, context.companyId, context.session.user.id, ["check_in_request"]);
      return {
        keyResult: recomputed.keyResult,
        checkIn: { ...checkIn, isCurrentEffective: recomputed.effectiveCheckIn?.id === checkIn.id },
      };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
