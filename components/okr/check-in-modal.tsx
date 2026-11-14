"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CheckInEntry, Confidence, Cycle, KeyResult } from "@/app/types";
import { apiRequest, formatDate } from "./goal-utils";
import { useWorkspace } from "./workspace-context";

export const confidenceLabels: Record<Confidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

export const confidenceClasses: Record<Confidence, string> = {
  on_track: "bg-rag-on-track-bg text-rag-on-track-ink",
  at_risk: "bg-rag-at-risk-bg text-rag-at-risk-ink",
  off_track: "bg-rag-off-track-bg text-rag-off-track-ink",
};

const CONFLICT_MESSAGE = "Someone else updated this key result — refresh and try again";

/** Today (local) clamped into the cycle, matching the server's default effective date. */
function defaultEffectiveDate(cycle: Pick<Cycle, "startDate" | "endDate">) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (today < cycle.startDate) return cycle.startDate;
  if (today > cycle.endDate) return cycle.endDate;
  return today;
}

export function CheckInModal({
  keyResult,
  cycle,
  correcting,
  onClose,
}: {
  keyResult: KeyResult;
  cycle: Pick<Cycle, "startDate" | "endDate">;
  /** Ledger entry this check-in corrects; its values prefill the form. */
  correcting: CheckInEntry | null;
  onClose: () => void;
}) {
  const { loadWorkspace, setFeedback } = useWorkspace();
  const binary = keyResult.metricType === "binary";
  const [value, setValue] = useState(String(Number(correcting?.value ?? keyResult.current)));
  const [effectiveDate, setEffectiveDate] = useState(correcting?.effectiveDate ?? defaultEffectiveDate(cycle));
  const [confidence, setConfidence] = useState<Confidence>(correcting?.confidence ?? keyResult.confidence ?? "on_track");
  const [note, setNote] = useState(correcting?.note ?? "");
  const [blockers, setBlockers] = useState(correcting?.blockers ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const numeric = Number(value);
    if (value.trim() === "" || !Number.isFinite(numeric)) return setError("Enter the new value as a number.");
    if (!effectiveDate) return setError("Choose the date this value applies to.");
    setSaving(true);
    try {
      const result = await apiRequest(`/api/key-results/${keyResult.id}/check-ins`, "POST", {
        version: keyResult.version,
        value: numeric,
        effectiveDate,
        confidence,
        note,
        blockers,
        correctsCheckInId: correcting?.id ?? null,
      });
      if (!result.ok) {
        if (result.status === 409) {
          setError(CONFLICT_MESSAGE);
          await loadWorkspace();
        } else {
          setError(result.data.error ?? "The check-in could not be saved.");
        }
        return;
      }
      await loadWorkspace();
      const effective = (result.data.checkIn as { isCurrentEffective?: boolean } | undefined)?.isCurrentEffective;
      setFeedback({
        tone: "success",
        message: effective === false
          ? "Check-in saved to history. A newer check-in still sets the current value."
          : correcting ? "Correction saved." : "Check-in saved.",
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{correcting ? "Correct check-in" : "Check in"}</DialogTitle>
          <DialogDescription>
            {keyResult.title} · current {Number(keyResult.current).toLocaleString()} → target {Number(keyResult.target).toLocaleString()} {keyResult.unit}
          </DialogDescription>
        </DialogHeader>
        {correcting && (
          <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            Replaces the entry by {correcting.authorName} for {formatDate(correcting.effectiveDate)} (value {Number(correcting.value).toLocaleString()}). The original stays in history, marked as superseded.
          </p>
        )}
        <form className="grid gap-4" onSubmit={save} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="check-in-value">{binary ? "State" : "New value"}</FieldLabel>
              {binary ? (
                <Select value={value === "1" ? "1" : "0"} onValueChange={setValue}>
                  <SelectTrigger id="check-in-value" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Not done</SelectItem>
                    <SelectItem value="1">Done</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input id="check-in-value" type="number" step="any" required value={value} onChange={(event) => setValue(event.target.value)} />
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="check-in-effective-date">Effective date</FieldLabel>
              <Input
                id="check-in-effective-date"
                type="date"
                required
                min={cycle.startDate}
                max={cycle.endDate}
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </Field>
          </div>
          <FieldDescription>An earlier date is kept in history but won't replace a newer check-in's value.</FieldDescription>
          <fieldset>
            <legend className="text-sm font-medium">Confidence</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(confidenceLabels) as Confidence[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setConfidence(level)}
                  aria-pressed={confidence === level}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${confidenceClasses[level]} ${confidence === level ? "ring-2 ring-ring" : ""}`}
                >
                  {confidenceLabels[level]}
                </button>
              ))}
            </div>
          </fieldset>
          <Field>
            <FieldLabel htmlFor="check-in-note">Note</FieldLabel>
            <Textarea id="check-in-note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="check-in-blockers">Blockers</FieldLabel>
            <Textarea id="check-in-blockers" maxLength={2000} rows={2} value={blockers} onChange={(event) => setBlockers(event.target.value)} />
          </Field>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Check-in not saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : correcting ? "Save correction" : "Save check-in"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
