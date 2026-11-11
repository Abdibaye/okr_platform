"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/okr/progress";
import type { Cycle, KeyResult, Objective, Workspace } from "./types";

type Feedback = { tone: "success" | "error"; message: string } | null;

const today = new Date().toISOString().slice(0, 10);

export function OkrDashboard() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [cycleName, setCycleName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [objectiveTitle, setObjectiveTitle] = useState("");
  const [krObjectiveId, setKrObjectiveId] = useState("");
  const [krTitle, setKrTitle] = useState("");
  const [metricType, setMetricType] = useState<KeyResult["metricType"]>("numeric");
  const [direction, setDirection] = useState<KeyResult["direction"]>("increasing");
  const [baseline, setBaseline] = useState("0");
  const [target, setTarget] = useState("100");
  const [current, setCurrent] = useState("0");
  const [openReason, setOpenReason] = useState("Correction needed after review");
  const [reopenReason, setReopenReason] = useState("");

  const loadWorkspace = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFeedback({ tone: "error", message: data.error ?? "Could not load the workspace." });
      return;
    }
    setWorkspace(data as Workspace);
    if (!selectedCycleId && data.cycles?.length) setSelectedCycleId(data.cycles[0].id);
  }, [selectedCycleId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const cycles = workspace?.cycles ?? [];
  const selectedCycle = cycles.find((cycle) => cycle.id === selectedCycleId);
  const selectedOpenCycle = selectedCycle?.status === "open" ? selectedCycle : undefined;
  const objectives = useMemo(() => cycles.flatMap((cycle) => cycle.objectives), [cycles]);

  async function send(url: string, method: string, body?: unknown, successMessage = "Saved.") {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", message: `${response.status}: ${data.error ?? "Request failed."}` });
        return null;
      }
      setFeedback({ tone: "success", message: successMessage });
      await loadWorkspace();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function createCycle(event: React.FormEvent) {
    event.preventDefault();
    const created = await send("/api/cycles", "POST", { name: cycleName, startDate, endDate }, "Cycle created as a draft.");
    if (created?.cycle?.id) {
      setSelectedCycleId(created.cycle.id);
      setCycleName("");
    }
  }

  async function openCycle() {
    if (!selectedCycle) return;
    await send("/api/cycles", "PATCH", { id: selectedCycle.id, reason: openReason }, "Cycle opened.");
  }

  async function closeCycle() {
    if (!selectedCycle) return;
    await send(`/api/cycles/${selectedCycle.id}/close`, "POST", { reason: openReason }, "Cycle closed.");
  }

  async function reopenCycle() {
    if (!selectedCycle) return;
    await send(`/api/cycles/${selectedCycle.id}/reopen`, "POST", { reason: reopenReason }, "Cycle reopened.");
  }

  async function createObjective(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCycle) return;
    const created = await send("/api/objectives", "POST", { cycleId: selectedCycle.id, title: objectiveTitle }, "Objective added.");
    if (created?.objective?.id) {
      setKrObjectiveId(created.objective.id);
      setObjectiveTitle("");
    }
  }

  async function createKeyResult(event: React.FormEvent) {
    event.preventDefault();
    await send("/api/key-results", "POST", {
      objectiveId: krObjectiveId,
      title: krTitle,
      metricType,
      direction,
      baseline: Number(baseline),
      target: Number(target),
      current: Number(current),
    }, "Key result added.");
    setKrTitle("");
  }

  async function updateKeyResult(keyResult: KeyResult) {
    await send(`/api/key-results/${keyResult.id}`, "PATCH", { current: Number(current) }, "Key result updated.");
  }

  async function simulateConflict(objective: Objective) {
    const first = await send(`/api/objectives/${objective.id}`, "PATCH", { version: objective.version, title: `${objective.title} — first edit` }, "First edit saved.");
    if (!first) return;
    await send(`/api/objectives/${objective.id}`, "PATCH", { version: objective.version, title: `${objective.title} — stale edit` }, "Conflict shown.");
  }

  async function logout() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = "/";
  }

  if (!workspace) return <p className="text-muted-foreground">Loading your workspace…</p>;
  const canManage = workspace.company.role === "admin" || workspace.company.role === "manager";
  const isAdmin = workspace.company.role === "admin";

  return (
    <div className="space-y-6">
      {feedback && (
        <Alert variant={feedback.tone === "error" ? "destructive" : "default"}>
          <AlertTitle>{feedback.tone === "error" ? "Action blocked" : "Done"}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">OKR workspace</h1>
          <p className="text-muted-foreground">{workspace.company.name} · {workspace.company.role}</p>
        </div>
        <Button variant="outline" onClick={logout}>Sign out</Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Create cycle</CardTitle><CardDescription>Cycles start as drafts. Open one before adding objectives.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={createCycle}>
              <Field><FieldLabel htmlFor="cycle-name">Name</FieldLabel><Input id="cycle-name" required value={cycleName} onChange={(event) => setCycleName(event.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field><FieldLabel htmlFor="cycle-start">Start</FieldLabel><Input id="cycle-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
                <Field><FieldLabel htmlFor="cycle-end">End</FieldLabel><Input id="cycle-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
              </div>
              <Button type="submit" disabled={busy || !canManage}>Create draft cycle</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cycle controls</CardTitle><CardDescription>Test opening, closing, and admin-only reopening.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Field><FieldLabel htmlFor="cycle-select">Cycle</FieldLabel>
              <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
                <SelectTrigger id="cycle-select" className="w-full"><SelectValue placeholder="Choose a cycle" /></SelectTrigger>
                <SelectContent>{cycles.map((cycle) => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field><FieldLabel htmlFor="cycle-note">Close note / open reason</FieldLabel><Input id="cycle-note" value={openReason} onChange={(event) => setOpenReason(event.target.value)} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || !canManage || selectedCycle?.status !== "draft"} onClick={openCycle}>Open cycle</Button>
              <Button disabled={busy || !canManage || selectedCycle?.status !== "open"} onClick={closeCycle}>Close cycle</Button>
            </div>
            <Field><FieldLabel htmlFor="reopen-reason">Admin reopen reason</FieldLabel><Input id="reopen-reason" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="At least 3 characters" /></Field>
            <Button disabled={busy || !isAdmin || selectedCycle?.status !== "closed" || reopenReason.trim().length < 3} onClick={reopenCycle}>Reopen with audit reason</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Objectives</CardTitle><CardDescription>Add an objective to the selected open cycle.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-3" onSubmit={createObjective}>
              <Field><FieldLabel htmlFor="objective-title">Objective title</FieldLabel><Input id="objective-title" required value={objectiveTitle} onChange={(event) => setObjectiveTitle(event.target.value)} /></Field>
              <Button type="submit" disabled={busy || !canManage || !selectedOpenCycle}>Add objective</Button>
            </form>
            <div className="space-y-4">
              {selectedCycle?.objectives.map((objective) => (
                <div key={objective.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-medium">{objective.title}</p><p className="text-xs text-muted-foreground">Version {objective.version}</p></div>
                    <Badge variant="outline">{Number(objective.progress).toFixed(0)}%</Badge>
                  </div>
                  <Progress value={Number(objective.progress)} />
                  <div className="space-y-2">
                    {objective.keyResults.map((keyResult) => (
                      <div key={keyResult.id} className="space-y-1 rounded-md bg-muted/50 p-2">
                        <div className="flex justify-between text-xs"><span>{keyResult.title}</span><span>{Number(keyResult.progress).toFixed(1)}%</span></div>
                        <Progress value={Number(keyResult.progress)} />
                        <p className="text-muted-foreground">{Number(keyResult.current)} / {Number(keyResult.target)} ({keyResult.direction}, baseline {Number(keyResult.baseline)})</p>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" disabled={busy || !selectedOpenCycle} onClick={() => simulateConflict(objective)}>Simulate stale edit</Button>
                </div>
              ))}
              {!selectedCycle?.objectives.length && <p className="text-sm text-muted-foreground">No objectives yet.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Key results</CardTitle><CardDescription>Progress clamps to 0–100 and supports decreasing targets.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-3" onSubmit={createKeyResult}>
              <Field><FieldLabel htmlFor="kr-objective">Objective</FieldLabel>
                <Select value={krObjectiveId} onValueChange={setKrObjectiveId}>
                  <SelectTrigger id="kr-objective" className="w-full"><SelectValue placeholder="Choose an objective" /></SelectTrigger>
                  <SelectContent>{selectedCycle?.objectives.map((objective) => <SelectItem key={objective.id} value={objective.id}>{objective.title}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field><FieldLabel htmlFor="kr-title">Key result title</FieldLabel><Input id="kr-title" required value={krTitle} onChange={(event) => setKrTitle(event.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field><FieldLabel htmlFor="kr-type">Metric</FieldLabel>
                  <Select value={metricType} onValueChange={(value) => setMetricType(value as KeyResult["metricType"])}>
                    <SelectTrigger id="kr-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{["numeric", "percentage", "currency", "binary"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field><FieldLabel htmlFor="kr-direction">Direction</FieldLabel>
                  <Select value={direction} onValueChange={(value) => setDirection(value as KeyResult["direction"])}>
                    <SelectTrigger id="kr-direction" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="increasing">increasing</SelectItem><SelectItem value="decreasing">decreasing</SelectItem></SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field><FieldLabel htmlFor="kr-baseline">Baseline</FieldLabel><Input id="kr-baseline" type="number" step="any" value={baseline} onChange={(event) => setBaseline(event.target.value)} /></Field>
                <Field><FieldLabel htmlFor="kr-target">Target</FieldLabel><Input id="kr-target" type="number" step="any" value={target} onChange={(event) => setTarget(event.target.value)} /></Field>
                <Field><FieldLabel htmlFor="kr-current">Current</FieldLabel><Input id="kr-current" type="number" step="any" value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
              </div>
              <Button type="submit" disabled={busy || !canManage || !selectedOpenCycle || !krObjectiveId}>Add key result</Button>
            </form>
            <Separator />
            <div className="space-y-3">
              {selectedCycle?.objectives.flatMap((objective) => objective.keyResults).map((keyResult) => (
                <div key={keyResult.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{keyResult.title}</p>
                  <p className="mb-2 text-xs text-muted-foreground">Current: {Number(keyResult.current)} · Progress {Number(keyResult.progress).toFixed(1)}%</p>
                  <div className="flex gap-2"><Input type="number" step="any" value={current} onChange={(event) => setCurrent(event.target.value)} /><Button variant="outline" disabled={busy || !selectedOpenCycle} onClick={() => updateKeyResult(keyResult)}>Update</Button></div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Workspace audit log</CardTitle><CardDescription>Cycle closes and admin reopens are recorded here.</CardDescription></CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Reason</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
            <TableBody>{workspace.audit.map((entry) => (
              <TableRow key={entry.id}><TableCell><Badge variant="secondary">{entry.action}</Badge></TableCell><TableCell>{entry.reason}</TableCell><TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell></TableRow>
            ))}
            {!workspace.audit.length && <TableRow><TableCell className="text-muted-foreground">No audit entries yet.</TableCell><TableCell /><TableCell /></TableRow>}
          </TableBody></Table>
        </CardContent>
      </Card>
    </div>
  );
}
