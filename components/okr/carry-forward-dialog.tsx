"use client";

import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Objective } from "@/app/types";
import { apiRequest, statusLabels } from "./goal-utils";
import { useWorkspace } from "./workspace-context";

type BaselineMode = "keep" | "current_as_baseline";

/** Mirrors the API rule: draft/active goals, or any goal that hasn't reached 100%. */
function isUnfinished(objective: Objective) {
  if (objective.status === "draft" || objective.status === "active") return true;
  return objective.progress === null || Number(objective.progress) < 100;
}

export function CarryForwardDialog({ defaultSourceId, onClose }: { defaultSourceId: string; onClose: () => void }) {
  const { workspace, loadWorkspace, setFeedback, setSelectedCycleId } = useWorkspace();
  const cycles = workspace?.cycles ?? [];
  const [sourceId, setSourceId] = useState(defaultSourceId || cycles[0]?.id || "");
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [baselineMode, setBaselineMode] = useState<BaselineMode>("keep");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const source = cycles.find((cycle) => cycle.id === sourceId);
  const targets = cycles.filter((cycle) => cycle.id !== sourceId && cycle.status !== "closed");
  const unfinished = useMemo(() => (source?.objectives ?? []).filter(isUnfinished), [source]);
  const allSelected = unfinished.length > 0 && unfinished.every((objective) => selected.has(objective.id));

  function changeSource(id: string) {
    setSourceId(id);
    setSelected(new Set());
    if (id === targetId) setTargetId("");
  }

  function toggle(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function carryForward(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!targetId) return setError("Choose a draft or open cycle to carry goals into.");
    if (!selected.size) return setError("Select at least one goal to carry forward.");
    setSaving(true);
    try {
      const result = await apiRequest(`/api/cycles/${sourceId}/carry-forward`, "POST", {
        targetCycleId: targetId,
        objectiveIds: [...selected],
        baselineMode,
      });
      if (!result.ok) {
        setError(result.data.error ?? "Goals could not be carried forward.");
        return;
      }
      await loadWorkspace();
      setSelectedCycleId(targetId);
      const carried = Number(result.data.carried ?? selected.size);
      const keyResults = Number(result.data.keyResults ?? 0);
      setFeedback({ tone: "success", message: `Carried forward ${carried} goal${carried === 1 ? "" : "s"} and ${keyResults} key result${keyResults === 1 ? "" : "s"}.` });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Carry forward goals</DialogTitle>
          <DialogDescription>Copy unfinished goals and their key results into another cycle. The originals stay unchanged.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={carryForward} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="carry-source">From cycle</FieldLabel>
              <Select value={sourceId} onValueChange={changeSource}>
                <SelectTrigger id="carry-source" className="w-full"><SelectValue placeholder="Choose a cycle" /></SelectTrigger>
                <SelectContent>
                  {cycles.map((cycle) => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name} ({cycle.status})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="carry-target">To cycle (draft or open)</FieldLabel>
              <Select value={targetId} onValueChange={setTargetId} disabled={!targets.length}>
                <SelectTrigger id="carry-target" className="w-full"><SelectValue placeholder={targets.length ? "Choose a cycle" : "No draft or open cycle"} /></SelectTrigger>
                <SelectContent>
                  {targets.map((cycle) => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name} ({cycle.status})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <fieldset className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-sm font-medium">Unfinished goals ({selected.size} of {unfinished.length} selected)</legend>
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={!unfinished.length}
                onClick={() => setSelected(allSelected ? new Set() : new Set(unfinished.map((objective) => objective.id)))}
              >
                {allSelected ? "Clear all" : "Select all"}
              </Button>
            </div>
            {unfinished.length ? (
              <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                {unfinished.map((objective) => (
                  <li key={objective.id} className="flex items-start gap-3 p-3">
                    <Checkbox
                      id={`carry-${objective.id}`}
                      className="mt-0.5"
                      checked={selected.has(objective.id)}
                      onCheckedChange={(checked) => toggle(objective.id, checked === true)}
                    />
                    <Label htmlFor={`carry-${objective.id}`} className="block min-w-0 font-normal">
                      <span className="block font-medium">{objective.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {statusLabels[objective.status]} · {objective.progress === null ? "No KRs" : `${Number(objective.progress).toFixed(0)}%`} · {objective.keyResults.length} key result{objective.keyResults.length === 1 ? "" : "s"}
                        {objective.owner && <> · {objective.owner.name}</>}
                      </span>
                    </Label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">No unfinished goals in this cycle.</p>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Key result baselines</legend>
            <RadioGroup value={baselineMode} onValueChange={(value) => setBaselineMode(value as BaselineMode)}>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="baseline-keep" value="keep" className="mt-0.5" />
                <Label htmlFor="baseline-keep" className="block font-normal leading-snug">
                  <span className="font-semibold">Keep baselines:</span> copies baseline, target and current values as they are.
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="baseline-current" value="current_as_baseline" className="mt-0.5" />
                <Label htmlFor="baseline-current" className="block font-normal leading-snug">
                  <span className="font-semibold">Start from current value:</span> each key result's current value becomes its new baseline, so progress restarts at 0%.
                </Label>
              </div>
            </RadioGroup>
          </fieldset>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Goals not carried forward</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !targetId || !selected.size}>
              {saving ? "Carrying forward…" : selected.size ? `Carry forward ${selected.size} goal${selected.size === 1 ? "" : "s"}` : "Carry forward"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
