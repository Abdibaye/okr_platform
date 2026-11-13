"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { AppShell } from "@/components/okr/app-shell";
import { CheckInModal, type CheckInDraft } from "@/components/okr/check-in-modal";
import { DashboardOverview } from "@/components/okr/dashboard-overview";
import { PeopleSection } from "@/components/okr/people-section";
import { PeriodComparisonSection } from "@/components/okr/period-comparison";
import { Progress, type ProgressTone } from "@/components/okr/progress";
import type { KeyResult, Objective, Workspace } from "./types";

type Feedback = { tone: "success" | "error"; message: string } | null;

const today = new Date().toISOString().slice(0, 10);

function metricValue(value: string) {
  return Number(value).toLocaleString();
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function focusField(id: string) {
  const field = document.getElementById(id);
  field?.scrollIntoView({ behavior: "smooth", block: "center" });
  field?.focus({ preventScroll: true });
}

function progressTone(progress: number): ProgressTone {
  if (progress >= 70) return "on_track";
  if (progress >= 40) return "at_risk";
  return "off_track";
}

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
  const [newKrCurrent, setNewKrCurrent] = useState("0");
  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(null);
  const [objTitleDraft, setObjTitleDraft] = useState("");
  const [objDescriptionDraft, setObjDescriptionDraft] = useState("");
  const [reflectionDraft, setReflectionDraft] = useState("");
  const [openReason, setOpenReason] = useState("Cycle review completed");
  const [reopenReason, setReopenReason] = useState("");
  const [search, setSearch] = useState("");
  const [checkInKrId, setCheckInKrId] = useState<string | null>(null);
  const [checkInDrafts, setCheckInDrafts] = useState<Record<string, CheckInDraft>>({});
  const [teamCount, setTeamCount] = useState<number | null>(null);

  const loadWorkspace = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/?session=expired";
      return;
    }
    if (response.status === 403) {
      window.location.href = "/deactivated";
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFeedback({ tone: "error", message: data.error ?? "Could not load the workspace." });
      return;
    }
    const loaded = data as Workspace;
    setWorkspace(loaded);
    setSelectedCycleId((currentSelected) => {
      if (currentSelected && loaded.cycles.some((cycle) => cycle.id === currentSelected)) {
        return currentSelected;
      }
      return loaded.cycles[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const workspaceRole = workspace?.company.role;
  useEffect(() => {
    if (workspaceRole !== "admin" && workspaceRole !== "manager") return;
    let cancelled = false;
    fetch("/api/teams", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.teams)) setTeamCount(data.teams.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceRole]);

  const cycles = workspace?.cycles ?? [];
  const selectedCycle = cycles.find((cycle) => cycle.id === selectedCycleId);
  const selectedOpenCycle = selectedCycle?.status === "open" ? selectedCycle : undefined;

  useEffect(() => {
    if (selectedCycle) {
      setReflectionDraft(selectedCycle.finalReflection);
    } else {
      setReflectionDraft("");
    }
  }, [selectedCycle?.id, selectedCycle?.finalReflection]);

  async function send(url: string, method: string, body?: unknown, successMessage = "Saved.") {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401) {
        window.location.href = "/?session=expired";
        return null;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", message: `${response.status}: ${data.error ?? "Request failed."}` });
        if (response.status === 409) {
          await loadWorkspace();
        }
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
    await send("/api/cycles", "PATCH", { id: selectedCycle.id, version: selectedCycle.version }, "Cycle opened.");
  }

  async function saveReflection() {
    if (!selectedCycle) return;
    await send(
      `/api/cycles/${selectedCycle.id}`,
      "PATCH",
      { finalReflection: reflectionDraft, version: selectedCycle.version },
      "Final reflection saved.",
    );
  }

  async function closeCycle() {
    if (!selectedCycle) return;
    await send(
      `/api/cycles/${selectedCycle.id}/close`,
      "POST",
      { reason: openReason, finalReflection: reflectionDraft, version: selectedCycle.version },
      "Cycle closed.",
    );
  }

  async function reopenCycle() {
    if (!selectedCycle) return;
    const reopened = await send(
      `/api/cycles/${selectedCycle.id}/reopen`,
      "POST",
      { reason: reopenReason, version: selectedCycle.version },
      "Cycle reopened.",
    );
    if (reopened) setReopenReason("");
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

  function startEditingObjective(objective: Objective) {
    setEditingObjectiveId(objective.id);
    setObjTitleDraft(objective.title);
    setObjDescriptionDraft(objective.description);
  }

  async function saveObjective(objective: Objective) {
    const saved = await send(
      `/api/objectives/${objective.id}`,
      "PATCH",
      { version: objective.version, title: objTitleDraft, description: objDescriptionDraft },
      "Objective updated.",
    );
    if (saved) setEditingObjectiveId(null);
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
      current: Number(newKrCurrent),
    }, "Key result added.");
    setKrTitle("");
  }

  async function updateKeyResult(keyResult: KeyResult) {
    const draft = checkInDrafts[keyResult.id];
    if (!draft) return;
    const saved = await send(
      `/api/key-results/${keyResult.id}`,
      "PATCH",
      { current: Number(draft.current), version: keyResult.version },
      "Key result updated.",
    );
    if (saved) {
      const entry = `${draft.effectiveDate || today} · value ${metricValue(draft.current)} · ${draft.confidence.replace("_", " ")}`;
      setCheckInDrafts((previous) => ({
        ...previous,
        [keyResult.id]: { ...draft, timeline: [entry, ...draft.timeline] },
      }));
      setCheckInKrId(null);
    }
  }

  function openCheckIn(keyResult: KeyResult) {
    setCheckInKrId(keyResult.id);
    setCheckInDrafts((previous) => ({
      ...previous,
      [keyResult.id]: previous[keyResult.id] ?? {
        current: String(Number(keyResult.current)),
        effectiveDate: today,
        confidence: "on_track",
        note: "",
        blockers: "",
        correctsPrevious: false,
        timeline: [],
      },
    }));
  }

  function updateCheckInDraft(keyResultId: string, draft: CheckInDraft) {
    setCheckInDrafts((previous) => ({ ...previous, [keyResultId]: draft }));
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

  if (!workspace) {
    return feedback?.tone === "error" ? (
      <Alert variant="destructive">
        <AlertTitle>Unable to load workspace</AlertTitle>
        <AlertDescription>{feedback.message}</AlertDescription>
      </Alert>
    ) : (
      <p className="text-muted-foreground">Loading your workspace…</p>
    );
  }

  const canManage = workspace.company.role === "admin" || workspace.company.role === "manager";
  const isAdmin = workspace.company.role === "admin";
  const normalizedSearch = search.trim().toLowerCase();
  const visibleObjectives = selectedCycle?.objectives.filter((objective) =>
    objective.title.toLowerCase().includes(normalizedSearch) ||
    objective.keyResults.some((keyResult) => keyResult.title.toLowerCase().includes(normalizedSearch))
  ) ?? [];
  const selectedCheckInKr = selectedCycle?.objectives
    .flatMap((objective) => objective.keyResults)
    .find((keyResult) => keyResult.id === checkInKrId);
  const selectedCheckInDraft = selectedCheckInKr ? checkInDrafts[selectedCheckInKr.id] : undefined;

  return (
    <AppShell
      workspace={workspace}
      unreadCount={workspace.audit.length}
      onSignOut={logout}
      search={search}
      onSearchChange={setSearch}
    >
      {feedback && (
        <Alert variant={feedback.tone === "error" ? "destructive" : "default"}>
          <AlertTitle>{feedback.tone === "error" ? "Action blocked" : "Done"}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      <div id="my-goals" className="sticky top-[104px] z-20 -mx-4 rounded-xl border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr] md:items-center">
          <Field>
            <FieldLabel htmlFor="cycle-select" className="text-xs text-muted-foreground">Active cycle</FieldLabel>
            <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
              <SelectTrigger id="cycle-select" className="w-full">
                <SelectValue placeholder="Choose a cycle" />
              </SelectTrigger>
              <SelectContent>
                {cycles.map((cycle) => (
                  <SelectItem key={cycle.id} value={cycle.id}>
                    {cycle.name} ({cycle.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {selectedCycle && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground md:justify-end">
              <Badge variant="outline">{selectedCycle.status}</Badge>
              <span>{selectedCycle.startDate} → {selectedCycle.endDate}</span>
              <Badge variant="secondary" className="font-mono tabular-nums">v{selectedCycle.version}</Badge>
            </div>
          )}
        </div>
      </div>

      <section id="company-okrs" className="grid gap-4 lg:grid-cols-2">
        <Card className="border-accent/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Cycle setup
              <Badge className="bg-accent text-accent-foreground">Governance</Badge>
            </CardTitle>
            <CardDescription>Cycles start as drafts. Open one before adding objectives.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={createCycle}>
              <Field>
                <FieldLabel htmlFor="cycle-name">Name</FieldLabel>
                <Input id="cycle-name" required value={cycleName} onChange={(event) => setCycleName(event.target.value)} disabled={busy || !canManage} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="cycle-start">Start</FieldLabel>
                  <Input id="cycle-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={busy || !canManage} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="cycle-end">End</FieldLabel>
                  <Input id="cycle-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={busy || !canManage} />
                </Field>
              </div>
              <Button type="submit" disabled={busy || !canManage} className="bg-brand-indigo text-white hover:bg-brand-indigo-hover">
                Create draft cycle
              </Button>
              {!canManage && <p className="text-xs text-muted-foreground">Managers and admins can create cycles.</p>}
            </form>
          </CardContent>
        </Card>

        <Card className="border-accent/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Cycle controls
              <Badge className="bg-accent text-accent-foreground">Governance</Badge>
            </CardTitle>
            <CardDescription>Open, close, and admin-reopen cycles with audit reasons and final reflections.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field>
              <FieldLabel htmlFor="cycle-reflection">Final reflection</FieldLabel>
              <Textarea
                id="cycle-reflection"
                value={reflectionDraft}
                onChange={(event) => setReflectionDraft(event.target.value)}
                disabled={busy || !canManage || !selectedOpenCycle}
                placeholder={
                  selectedCycle?.status === "closed"
                    ? "Cycle is closed — reflection is locked until reopened by an admin."
                    : "Summarize wins, misses, and learnings for this cycle..."
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cycle-note">Close audit note</FieldLabel>
              <Input id="cycle-note" value={openReason} onChange={(event) => setOpenReason(event.target.value)} disabled={busy || !canManage || !selectedOpenCycle} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy || !canManage || selectedCycle?.status !== "draft"}
                title={selectedCycle?.status !== "draft" ? "Only draft cycles can be opened." : undefined}
                onClick={openCycle}
              >
                Open cycle
              </Button>
              <Button
                variant="outline"
                disabled={busy || !canManage || !selectedOpenCycle}
                title={!selectedOpenCycle ? "Open the cycle before saving its reflection." : undefined}
                onClick={saveReflection}
              >
                Save reflection
              </Button>
              <Button
                disabled={busy || !canManage || selectedCycle?.status !== "open"}
                title={selectedCycle?.status !== "open" ? "Only open cycles can be closed." : undefined}
                onClick={closeCycle}
              >
                Close cycle
              </Button>
            </div>
            <Field>
              <FieldLabel htmlFor="reopen-reason">Admin reopen reason</FieldLabel>
              <Input
                id="reopen-reason"
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="At least 3 characters"
                disabled={busy || !isAdmin || selectedCycle?.status !== "closed"}
              />
            </Field>
            <Button
              disabled={busy || !isAdmin || selectedCycle?.status !== "closed" || reopenReason.trim().length < 3}
              title={!isAdmin ? "Only admins can reopen a closed cycle." : selectedCycle?.status !== "closed" ? "Only closed cycles can be reopened." : "Enter an audit reason of at least 3 characters."}
              onClick={reopenCycle}
            >
              Reopen with audit reason
            </Button>
          </CardContent>
        </Card>
      </section>

      <section id="team-manager" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Objectives</CardTitle>
            <CardDescription>Add or edit objectives in the selected open cycle (optimistic version locked).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-3" onSubmit={createObjective}>
              <Field>
                <FieldLabel htmlFor="objective-title">Objective title</FieldLabel>
                <Input id="objective-title" required value={objectiveTitle} onChange={(event) => setObjectiveTitle(event.target.value)} disabled={busy || !canManage || !selectedOpenCycle} />
              </Field>
              <Button type="submit" disabled={busy || !canManage || !selectedOpenCycle}>Add objective</Button>
            </form>
            <div className="space-y-4">
              {visibleObjectives.map((objective) => {
                const objectiveProgress = objective.keyResults.length && objective.progress !== null ? Number(objective.progress) : null;
                return (
                  <article key={objective.id} className="rounded-xl border bg-card p-4">
                    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-foreground">{objective.title}</h3>
                        {objective.description && <p className="mt-1 text-xs text-muted-foreground">{objective.description}</p>}
                        <p className="mt-1 text-xs text-muted-foreground">Owner: {workspace.user.name} · {workspace.company.role}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{selectedCycle?.status ?? "No cycle"}</Badge>
                        <Badge variant="secondary" className="font-mono tabular-nums">v{objective.version}</Badge>
                        <Badge variant={objectiveProgress === null ? "secondary" : "default"} className="tabular-nums">
                          {objectiveProgress === null ? "No KRs" : `${objectiveProgress.toFixed(0)}%`}
                        </Badge>
                      </div>
                    </header>
                    <div className="mt-3">
                      <Progress value={objectiveProgress} tone={objectiveProgress === null ? "neutral" : progressTone(objectiveProgress)} aria-label={`${objective.title} progress`} />
                    </div>
                    {editingObjectiveId === objective.id && (
                      <div className="mt-3 grid gap-2 rounded-lg border bg-muted/30 p-3">
                        <Input value={objTitleDraft} onChange={(event) => setObjTitleDraft(event.target.value)} aria-label="Edit objective title" />
                        <Textarea value={objDescriptionDraft} onChange={(event) => setObjDescriptionDraft(event.target.value)} placeholder="Description" aria-label="Edit objective description" />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy || !selectedOpenCycle} onClick={() => saveObjective(objective)}>Save objective</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingObjectiveId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                    <div className="mt-3 divide-y divide-border rounded-lg bg-inset">
                      {objective.keyResults.map((keyResult) => {
                        const keyResultProgress = Number(keyResult.progress);
                        return (
                          <div key={keyResult.id} className="grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <p className="text-sm font-semibold text-foreground">{keyResult.title}</p>
                                <span className="text-xs text-muted-foreground">Owner: {workspace.user.name}</span>
                              </div>
                              <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                                {metricValue(keyResult.baseline)} → {metricValue(keyResult.current)} → {metricValue(keyResult.target)} {keyResult.unit}
                              </p>
                              <div className="mt-2">
                                <Progress value={keyResultProgress} tone={progressTone(keyResultProgress)} aria-label={`${keyResult.title} progress`} />
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                              <span className="text-sm font-semibold tabular-nums">{keyResultProgress.toFixed(1)}%</span>
                              <Button size="sm" disabled={busy || !selectedOpenCycle} title={!selectedOpenCycle ? "Open the cycle before checking in." : undefined} onClick={() => openCheckIn(keyResult)}>
                                Check in
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {!objective.keyResults.length && <p className="p-3 text-xs text-muted-foreground">No KRs</p>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" disabled={busy || !selectedOpenCycle} onClick={() => startEditingObjective(objective)}>Edit objective</Button>
                      <Button variant="outline" size="sm" disabled={busy || !selectedOpenCycle} onClick={() => simulateConflict(objective)}>Simulate stale edit</Button>
                    </div>
                  </article>
                );
              })}
              {!selectedCycle?.objectives.length && <p className="text-sm text-muted-foreground">No objectives yet.</p>}
              {Boolean(selectedCycle?.objectives.length) && !visibleObjectives.length && (
                <p className="text-sm text-muted-foreground">No objectives match the current search.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key results</CardTitle>
            <CardDescription>Progress clamps to 0–100, supports decreasing targets, and checks version on save.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-3" onSubmit={createKeyResult}>
              <Field>
                <FieldLabel htmlFor="kr-objective">Objective</FieldLabel>
                <Select value={krObjectiveId} onValueChange={setKrObjectiveId}>
                  <SelectTrigger id="kr-objective" className="w-full"><SelectValue placeholder="Choose an objective" /></SelectTrigger>
                  <SelectContent>{selectedCycle?.objectives.map((objective) => <SelectItem key={objective.id} value={objective.id}>{objective.title}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="kr-title">Key result title</FieldLabel>
                <Input id="kr-title" required value={krTitle} onChange={(event) => setKrTitle(event.target.value)} disabled={busy || !selectedOpenCycle} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="kr-type">Metric</FieldLabel>
                  <Select value={metricType} onValueChange={(value) => setMetricType(value as KeyResult["metricType"])}>
                    <SelectTrigger id="kr-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{["numeric", "percentage", "currency", "binary"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="kr-direction">Direction</FieldLabel>
                  <Select value={direction} onValueChange={(value) => setDirection(value as KeyResult["direction"])}>
                    <SelectTrigger id="kr-direction" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="increasing">increasing</SelectItem><SelectItem value="decreasing">decreasing</SelectItem></SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field><FieldLabel htmlFor="kr-baseline">Baseline</FieldLabel><Input id="kr-baseline" type="number" step="any" value={baseline} onChange={(event) => setBaseline(event.target.value)} disabled={busy || !selectedOpenCycle} /></Field>
                <Field><FieldLabel htmlFor="kr-target">Target</FieldLabel><Input id="kr-target" type="number" step="any" value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy || !selectedOpenCycle} /></Field>
                <Field><FieldLabel htmlFor="kr-current">Current</FieldLabel><Input id="kr-current" type="number" step="any" value={newKrCurrent} onChange={(event) => setNewKrCurrent(event.target.value)} disabled={busy || !selectedOpenCycle} /></Field>
              </div>
              <Button type="submit" disabled={busy || !selectedOpenCycle || !krObjectiveId}>Add key result</Button>
            </form>
            <Separator />
            <p className="text-xs text-muted-foreground">Use Check in on an objective’s key result to update its current value with version protection.</p>
          </CardContent>
        </Card>
      </section>

      <section id="alignment">
        <PeriodComparisonSection summaries={workspace.summaries} comparisons={workspace.comparisons} />
      </section>

      <section id="reports">
        <Card>
          <CardHeader>
            <CardTitle>Workspace audit log</CardTitle>
            <CardDescription>Cycle closes and admin reopens are recorded here.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.audit.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell><Badge variant="secondary">{entry.action}</Badge></TableCell>
                    <TableCell>{entry.reason}</TableCell>
                    <TableCell className="tabular-nums">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {!workspace.audit.length && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No audit entries yet.</TableCell>
                    <TableCell /><TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {canManage && (
        <section id="people">
          <PeopleSection role={workspace.company.role} currentUserId={workspace.user.id} />
        </section>
      )}

      {selectedCheckInKr && selectedCheckInDraft && (
        <CheckInModal
          keyResult={selectedCheckInKr}
          draft={selectedCheckInDraft}
          busy={busy}
          onClose={() => setCheckInKrId(null)}
          onChange={(draft) => updateCheckInDraft(selectedCheckInKr.id, draft)}
          onSubmit={() => updateKeyResult(selectedCheckInKr)}
        />
      )}
    </AppShell>
  );
}
