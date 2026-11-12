"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { KeyResult } from "@/app/types";

type Confidence = "on_track" | "at_risk" | "off_track";

export interface CheckInDraft {
  current: string;
  effectiveDate: string;
  confidence: Confidence;
  note: string;
  blockers: string;
  correctsPrevious: boolean;
  timeline: string[];
}

const confidenceLabels: Record<Confidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

const confidenceClasses: Record<Confidence, string> = {
  on_track: "bg-rag-on-track-bg text-rag-on-track-ink",
  at_risk: "bg-rag-at-risk-bg text-rag-at-risk-ink",
  off_track: "bg-rag-off-track-bg text-rag-off-track-ink",
};

export function CheckInModal({
  keyResult,
  draft,
  busy,
  onClose,
  onChange,
  onSubmit,
}: {
  keyResult: KeyResult;
  draft: CheckInDraft;
  busy: boolean;
  onClose: () => void;
  onChange: (draft: CheckInDraft) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/70 p-4">
      <button type="button" className="absolute inset-0 bg-transparent" onClick={onClose} aria-label="Close check-in dialog" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-in-title"
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl border bg-card p-5 shadow-modal"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="check-in-title" className="text-base font-semibold">Check in</h2>
            <p className="text-sm text-muted-foreground">{keyResult.title} · v{keyResult.version}</p>
            <p className="text-xs text-muted-foreground">Current {Number(keyResult.current).toLocaleString()} → Target {Number(keyResult.target).toLocaleString()} {keyResult.unit}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close check-in dialog"><X /></Button>
        </div>

        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Field>
            <FieldLabel htmlFor="check-in-effective-date">Effective date</FieldLabel>
            <Input id="check-in-effective-date" type="date" value={draft.effectiveDate} onChange={(event) => onChange({ ...draft, effectiveDate: event.target.value })} disabled={busy} />
          </Field>
          <Field>
            <FieldLabel htmlFor="check-in-value">New value</FieldLabel>
            <Input id="check-in-value" type="number" step="any" value={draft.current} onChange={(event) => onChange({ ...draft, current: event.target.value })} required disabled={busy} />
          </Field>
          <fieldset>
            <legend className="text-xs font-medium">Confidence</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(confidenceLabels) as Confidence[]).map((value) => (
                <button key={value} type="button" onClick={() => onChange({ ...draft, confidence: value })} aria-pressed={draft.confidence === value} className={`rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${confidenceClasses[value]} ${draft.confidence === value ? "ring-2 ring-ring" : ""}`}>
                  {confidenceLabels[value]}
                </button>
              ))}
            </div>
          </fieldset>
          <Field>
            <FieldLabel htmlFor="check-in-note">Note</FieldLabel>
            <Textarea id="check-in-note" value={draft.note} onChange={(event) => onChange({ ...draft, note: event.target.value })} disabled={busy} />
          </Field>
          <Field>
            <FieldLabel htmlFor="check-in-blockers">Blockers</FieldLabel>
            <Input id="check-in-blockers" value={draft.blockers} onChange={(event) => onChange({ ...draft, blockers: event.target.value })} disabled={busy} />
          </Field>
          <button type="button" onClick={() => onChange({ ...draft, correctsPrevious: !draft.correctsPrevious })} className="w-fit text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {draft.correctsPrevious ? "Corrects previous check-in: on" : "Corrects previous check-in: off"}
          </button>
          <Button type="submit" disabled={busy}>Save check-in</Button>
        </form>

        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-semibold">Session timeline</p>
          {draft.timeline.length ? (
            <ol className="mt-2 grid gap-2">
              {draft.timeline.map((entry, index) => (
                <li key={index} className="rounded-lg bg-inset p-2 text-xs text-muted-foreground">{entry} · session-only</li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No session check-ins captured yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
