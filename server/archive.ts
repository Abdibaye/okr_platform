import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { canEditKeyResult, canEditObjective, loadAccessIndex, viewerFromContext, type ObjectiveAccessFacts } from "./org-access";
import type { RequestContext } from "./request-context";
import { keyResults, objectives } from "./schema";
import { InputError } from "./objectives";

export async function loadEditableObjective(context: RequestContext, objectiveId: string) {
  const [objective] = await getDb().select().from(objectives)
    .where(and(eq(objectives.id, objectiveId), eq(objectives.companyId, context.companyId))).limit(1);
  if (!objective) throw new InputError("Goal not found.", 404);
  const facts = await loadAccessIndex(getDb(), context.companyId, [objective.id]).then((index) => index.factsFor(objective));
  const viewer = viewerFromContext(context);
  if (!canEditObjective(objective, viewer, facts)) throw new InputError("You cannot archive or restore this goal.", 403);
  return objective;
}

export async function loadEditableKeyResult(context: RequestContext, keyResultId: string) {
  const [keyResult] = await getDb().select().from(keyResults)
    .where(and(eq(keyResults.id, keyResultId), eq(keyResults.companyId, context.companyId))).limit(1);
  if (!keyResult) throw new InputError("Key result not found.", 404);
  const [objective] = await getDb().select().from(objectives)
    .where(and(eq(objectives.id, keyResult.objectiveId), eq(objectives.companyId, context.companyId))).limit(1);
  if (!objective) throw new InputError("Goal not found.", 404);
  const viewer = viewerFromContext(context);
  const facts = await loadAccessIndex(getDb(), context.companyId, [objective.id]).then((index) => index.factsFor(objective));
  if (!canEditKeyResult(objective, keyResult, viewer, facts, [])) throw new InputError("You cannot archive or restore this key result.", 403);
  return keyResult;
}
