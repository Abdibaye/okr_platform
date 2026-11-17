"use client";

import { useEffect, useState } from "react";
import { PencilLine } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CheckInEntry, KeyResult } from "@/app/types";
import { confidenceClasses, confidenceLabels } from "./check-in-modal";
import { apiRequest, formatDate } from "./goal-utils";

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function KeyResultHistoryDialog({
  keyResult,
  canCorrect,
  onCorrect,
  onClose,
}: {
  keyResult: KeyResult;
  /** False when the viewer can't check in or the cycle isn't open. */
  canCorrect: boolean;
  onCorrect: (entry: CheckInEntry) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CheckInEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch whenever the key result's version moves (a new check-in or correction was saved).
  useEffect(() => {
    let cancelled = false;
    void apiRequest(`/api/key-results/${keyResult.id}/check-ins`, "GET").then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.data.error ?? "History could not be loaded.");
        return;
      }
      setError(null);
      setEntries(result.data.checkIns as CheckInEntry[]);
    });
    return () => { cancelled = true; };
  }, [keyResult.id, keyResult.version]);

  const byId = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  const binary = keyResult.metricType === "binary";
  const showValue = (value: string) => binary ? (Number(value) === 1 ? "Done" : "Not done") : `${Number(value).toLocaleString()} ${keyResult.unit}`.trim();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check-in history</DialogTitle>
          <DialogDescription>
            {keyResult.title}. Entries are never edited or deleted; the newest effective date sets the current value, and a correction replaces the entry it corrects.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!entries && !error && <p className="text-sm text-muted-foreground" role="status">Loading history…</p>}
        {entries && entries.length === 0 && <p className="text-sm text-muted-foreground">No check-ins yet.</p>}
        {entries && entries.length > 0 && (
          <ol className="grid gap-3" aria-label="Check-ins, newest effective date first">
            {entries.map((entry) => {
              const corrected = entry.correctsCheckInId ? byId.get(entry.correctsCheckInId) : undefined;
              return (
                <li key={entry.id} className={`rounded-lg border p-3 ${entry.isSuperseded ? "bg-muted/40 text-muted-foreground" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold tabular-nums ${entry.isSuperseded ? "line-through" : ""}`}>
                        {showValue(entry.value)} <span className="font-normal text-muted-foreground">· {Number(Number(entry.progress).toFixed(2))}%</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Effective {formatDate(entry.effectiveDate)} · {entry.authorName} · logged {formatTimestamp(entry.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={confidenceClasses[entry.confidence]}>{confidenceLabels[entry.confidence]}</Badge>
                      {entry.isCurrentEffective && <Badge>Current</Badge>}
                      {entry.isSuperseded && <Badge variant="outline">Superseded</Badge>}
                    </div>
                  </div>
                  {corrected && (
                    <p className="mt-2 text-xs">Corrects the {formatDate(corrected.effectiveDate)} entry ({showValue(corrected.value)}).</p>
                  )}
                  {entry.note && <p className="mt-2 whitespace-pre-wrap text-sm">{entry.note}</p>}
                  {entry.blockers && (
                    <p className="mt-1 whitespace-pre-wrap text-sm"><span className="font-medium">Blockers:</span> {entry.blockers}</p>
                  )}
                  {canCorrect && !entry.isSuperseded && (
                    <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => onCorrect(entry)}>
                      <PencilLine aria-hidden="true" /> Correct this
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
