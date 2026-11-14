"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { KeyResult, Objective } from "@/app/types";
import { apiRequest, describeSaveError } from "./goal-utils";
import { useWorkspace } from "./workspace-context";

const NONE = "none";

const metricLabels: Record<KeyResult["metricType"], string> = {
  numeric: "Number",
  percentage: "Percentage",
  currency: "Currency",
  binary: "Done / not done",
};

interface KeyResultDraft {
  title: string;
  metricType: KeyResult["metricType"];
  direction: KeyResult["direction"];
  unit: string;
  baseline: string;
  target: string;
  current: string;
  ownerId: string;
  dueDate: string;
}

function draftFrom(keyResult: KeyResult): KeyResultDraft {
  return {
    title: keyResult.title,
    metricType: keyResult.metricType,
    direction: keyResult.direction,
    unit: keyResult.unit,
    baseline: String(Number(keyResult.baseline)),
    target: String(Number(keyResult.target)),
    current: String(Number(keyResult.current)),
    ownerId: keyResult.ownerId ?? NONE,
    dueDate: keyResult.dueDate ?? "",
  };
}

export function KeyResultDialog({
  objective,
  keyResult,
  onClose,
}: {
  objective: Objective;
  /** Key result being edited; null adds a new one to `objective`. */
  keyResult: KeyResult | null;
  onClose: () => void;
}) {
  const { workspace, loadWorkspace, setFeedback } = useWorkspace();
  const [draft, setDraft] = useState<KeyResultDraft>(() => keyResult ? draftFrom(keyResult) : {
    title: "",
    metricType: "numeric",
    direction: "increasing",
    unit: "",
    baseline: "0",
    target: "100",
    current: "0",
    ownerId: objective.ownerId ?? NONE,
    dueDate: objective.dueDate ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadAfterConflict, setReloadAfterConflict] = useState(false);

  useEffect(() => {
    if (reloadAfterConflict && keyResult) {
      setDraft(draftFrom(keyResult));
      setReloadAfterConflict(false);
    }
  }, [keyResult?.version]);

  const members = (workspace?.members ?? []).filter((member) => member.isActive);
  const binary = draft.metricType === "binary";

  function update<K extends keyof KeyResultDraft>(key: K, value: KeyResultDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function changeMetric(metricType: KeyResult["metricType"]) {
    setDraft((previous) => metricType === "binary"
      ? { ...previous, metricType, direction: "increasing", baseline: "0", target: "1", current: previous.current === "1" ? "1" : "0" }
      : { ...previous, metricType, unit: metricType === "percentage" && !previous.unit ? "%" : previous.unit });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const values = { baseline: Number(draft.baseline), target: Number(draft.target), current: Number(draft.current) };
    if (!draft.title.trim()) return setError("Give the key result a title.");
    if (![values.baseline, values.target, values.current].every(Number.isFinite) || draft.baseline === "" || draft.target === "" || draft.current === "") {
      return setError("Baseline, target and current value must all be numbers.");
    }
    if (values.baseline === values.target) return setError("Baseline and target can't be the same, otherwise progress can't be measured.");

    const fields = {
      title: draft.title.trim(),
      metricType: draft.metricType,
      direction: draft.direction,
      unit: draft.unit.trim(),
      ...values,
      ownerId: draft.ownerId === NONE ? null : draft.ownerId,
      dueDate: draft.dueDate || null,
    };
    let body: Record<string, unknown>;
    if (keyResult) {
      const before = draftFrom(keyResult);
      body = { version: keyResult.version };
      if (fields.title !== before.title) body.title = fields.title;
      if (fields.metricType !== before.metricType) body.metricType = fields.metricType;
      if (fields.direction !== before.direction) body.direction = fields.direction;
      if (fields.unit !== before.unit) body.unit = fields.unit;
      if (fields.baseline !== Number(before.baseline)) body.baseline = fields.baseline;
      if (fields.target !== Number(before.target)) body.target = fields.target;
      if (fields.current !== Number(before.current)) body.current = fields.current;
      if (fields.ownerId !== keyResult.ownerId) body.ownerId = fields.ownerId;
      if (fields.dueDate !== keyResult.dueDate) body.dueDate = fields.dueDate;
      if (Object.keys(body).length === 1) return onClose();
    } else {
      body = { objectiveId: objective.id, ...fields };
    }

    setSaving(true);
    try {
      const result = keyResult
        ? await apiRequest(`/api/key-results/${keyResult.id}`, "PATCH", body)
        : await apiRequest("/api/key-results", "POST", body);
      if (!result.ok) {
        setError(describeSaveError(result, "key result"));
        if (result.status === 409) {
          setReloadAfterConflict(true);
          await loadWorkspace();
        }
        return;
      }
      await loadWorkspace();
      setFeedback({ tone: "success", message: keyResult ? "Key result updated." : "Key result added." });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{keyResult ? "Edit key result" : "Add key result"}</DialogTitle>
          <DialogDescription>
            For goal: {objective.title}
            {keyResult && <> · version {keyResult.version}</>}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={save} noValidate>
          <Field>
            <FieldLabel htmlFor="kr-title">Title</FieldLabel>
            <Input id="kr-title" required maxLength={240} value={draft.title} onChange={(event) => update("title", event.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="kr-metric">Metric type</FieldLabel>
              <Select value={draft.metricType} onValueChange={(value) => changeMetric(value as KeyResult["metricType"])}>
                <SelectTrigger id="kr-metric" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(metricLabels) as KeyResult["metricType"][]).map((metric) => <SelectItem key={metric} value={metric}>{metricLabels[metric]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="kr-direction">Direction</FieldLabel>
              <Select value={draft.direction} onValueChange={(value) => update("direction", value as KeyResult["direction"])} disabled={binary}>
                <SelectTrigger id="kr-direction" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="increasing">Increase to target</SelectItem>
                  <SelectItem value="decreasing">Decrease to target</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="kr-unit">Unit</FieldLabel>
              <Input id="kr-unit" maxLength={24} placeholder={draft.metricType === "currency" ? "USD" : "e.g. users"} value={draft.unit} onChange={(event) => update("unit", event.target.value)} disabled={binary} />
            </Field>
          </div>
          {binary ? (
            <Field>
              <FieldLabel htmlFor="kr-current">Current state</FieldLabel>
              <Select value={draft.current} onValueChange={(value) => update("current", value)}>
                <SelectTrigger id="kr-current" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Not done (0%)</SelectItem>
                  <SelectItem value="1">Done (100%)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="kr-baseline">Baseline</FieldLabel>
                <Input id="kr-baseline" type="number" step="any" required value={draft.baseline} onChange={(event) => update("baseline", event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="kr-target">Target</FieldLabel>
                <Input id="kr-target" type="number" step="any" required value={draft.target} onChange={(event) => update("target", event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="kr-current">Current</FieldLabel>
                <Input id="kr-current" type="number" step="any" required value={draft.current} onChange={(event) => update("current", event.target.value)} />
              </Field>
            </div>
          )}
          {!binary && <FieldDescription>Progress runs from baseline (0%) to target (100%). For a decreasing metric, set a target below the baseline.</FieldDescription>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="kr-owner">Owner</FieldLabel>
              <Select value={draft.ownerId} onValueChange={(value) => update("ownerId", value)}>
                <SelectTrigger id="kr-owner" className="w-full"><SelectValue placeholder="No owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No owner</SelectItem>
                  {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="kr-due">Due date</FieldLabel>
              <Input id="kr-due" type="date" value={draft.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
            </Field>
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Key result not saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : keyResult ? "Save key result" : "Add key result"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
