"use client";

import { useState } from "react";
import { GitFork, List, Network, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CheckInModal, type CheckInDraft } from "@/components/okr/check-in-modal";
import { CycleBanner } from "@/components/okr/cycle-banner";
import { Progress, type ProgressTone } from "@/components/okr/progress";
import { useWorkspace } from "@/components/okr/workspace-context";
import type { KeyResult, Objective } from "@/app/types";

const today = new Date().toISOString().slice(0, 10);

function metricValue(value: string) {
  return Number(value).toLocaleString();
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

export default function GoalsPage() {
  const { workspace, selectedCycle, selectedOpenCycle, canManage, busy, send } = useWorkspace();
  const [search, setSearch] = useState("");
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
  const [checkInKrId, setCheckInKrId] = useState<string | null>(null);
  const [checkInDrafts, setCheckInDrafts] = useState<Record<string, CheckInDraft>>({});

  const normalizedSearch = search.trim().toLowerCase();
  const visibleObjectives = selectedCycle?.objectives.filter((objective) =>
    objective.title.toLowerCase().includes(normalizedSearch) ||
    objective.keyResults.some((keyResult) => keyResult.title.toLowerCase().includes(normalizedSearch))
  ) ?? [];

  const selectedCheckInKr = selectedCycle?.objectives
    .flatMap((objective) => objective.keyResults)
    .find((keyResult) => keyResult.id === checkInKrId);
  const selectedCheckInDraft = selectedCheckInKr ? checkInDrafts[selectedCheckInKr.id] : undefined;

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

  if (!workspace) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl lg:text-4xl">Goals</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track objectives in the selected cycle, align key results, and check in on progress.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button
              disabled={!selectedOpenCycle}
              title={!selectedOpenCycle ? "Open a cycle before adding objectives." : undefined}
              onClick={() => focusField("objective-title")}
            >
              <Plus aria-hidden="true" /> New objective
            </Button>
          )}
          <Button
            variant={canManage ? "outline" : "default"}
            disabled={!selectedOpenCycle || !selectedCycle?.objectives.length}
            title={!selectedOpenCycle ? "Open a cycle before adding key results." : !selectedCycle?.objectives.length ? "Add an objective first." : undefined}
            onClick={() => focusField("kr-title")}
          >
            <Plus aria-hidden="true" /> New key result
          </Button>
        </div>
      </header>

      <Tabs defaultValue="list" className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="list" className="gap-2">
              <List className="size-4" /> Goals list
            </TabsTrigger>
            <TabsTrigger value="alignment" className="gap-2">
              <Network className="size-4" /> Alignment view
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="list" className="space-y-6">
          <CycleBanner showSearch search={search} onSearchChange={setSearch} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] xl:items-start">
            <Card className="shadow-none">
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
                      <article key={objective.id} id={`objective-${objective.id}`} className="scroll-mt-20 rounded-xl border bg-card p-4 md:scroll-mt-6">
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
                        <div className="mt-3 divide-y rounded-lg border bg-background">
                          {objective.keyResults.map((keyResult) => {
                            const keyResultProgress = Number(keyResult.progress);
                            return (
                              <div key={keyResult.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 space-y-1">
                                  <p className="text-sm font-medium">{keyResult.title}</p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    {metricValue(keyResult.current)} of {metricValue(keyResult.target)} {keyResult.unit} ({keyResult.metricType}, {keyResult.direction}, baseline {metricValue(keyResult.baseline)}) · v{keyResult.version}
                                  </p>
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

            <Card className="shadow-none">
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
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="alignment" className="space-y-6">
          <CycleBanner />
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitFork className="size-5 text-brand-teal" /> Alignment hierarchy
              </CardTitle>
              <CardDescription>
                Shows how individual and team goals link to company-level objectives in this cycle.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedCycle?.objectives.length ? (
                <div className="space-y-4">
                  {selectedCycle.objectives.map((objective, idx) => (
                    <div key={objective.id} className="flex items-start gap-3 rounded-lg border bg-card p-4">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-xs font-semibold text-brand-teal">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-foreground">{objective.title}</p>
                          <Badge variant={objective.progress === null ? "secondary" : "default"}>
                            {objective.progress === null ? "No KRs" : `${Number(objective.progress).toFixed(0)}%`}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{objective.keyResults.length} key result(s) linked directly</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No objectives to display in this cycle.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
