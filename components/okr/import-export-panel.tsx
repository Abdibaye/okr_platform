"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ImportResponse {
  errors?: Array<{ row: number; reason: string }>;
  plannedObjectives?: number;
  plannedKeyResults?: number;
  committed?: boolean;
  dryRun?: boolean;
}

export function ImportExportPanel({ cycleId }: { cycleId?: string }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(dryRun: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/imports/okrs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dryRun }),
      });
      const data = await response.json().catch(() => ({}) as ImportResponse);
      setPreview(data);
      if (!response.ok) setMessage(data.errors?.length ? `${data.errors.length} row error${data.errors.length === 1 ? "" : "s"} found.` : "Import failed.");
      else setMessage(dryRun ? `Preview ready: ${data.plannedObjectives ?? 0} goals, ${data.plannedKeyResults ?? 0} key results.` : "Import committed.");
    } finally {
      setBusy(false);
    }
  }

  const query = cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : "";
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Import and export</CardTitle>
        <CardDescription>Preview an OKR CSV, see row-by-row errors, then commit only when every row is valid.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={6} placeholder="Paste OKR CSV here" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || !csv.trim()} onClick={() => void submit(true)}>Preview import</Button>
          <Button disabled={busy || !csv.trim()} onClick={() => void submit(false)}>Import valid rows</Button>
          <Button asChild variant="outline"><a href={`/api/exports/okrs${query}`}>Export OKRs</a></Button>
          <Button asChild variant="outline"><a href={`/api/exports/check-ins${query}`}>Export check-ins</a></Button>
        </div>
        {message && <p className="text-sm">{message}</p>}
        {!!preview?.errors?.length && (
          <div className="space-y-1 text-sm">
            {preview.errors.map((error, index) => (
              <p key={`${error.row}-${index}`}><strong>Row {error.row}:</strong> {error.reason}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
