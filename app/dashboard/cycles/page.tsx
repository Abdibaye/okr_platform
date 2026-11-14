"use client";

import { useEffect, useState } from "react";
import { CopyPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CarryForwardDialog } from "@/components/okr/carry-forward-dialog";
import { CycleBanner } from "@/components/okr/cycle-banner";
import { useWorkspace } from "@/components/okr/workspace-context";
import type { CheckInCadence } from "@/app/types";

const today = new Date().toISOString().slice(0, 10);

const QUARTERS = [
  { value: "1", label: "Q1 (Jan – Mar)" },
  { value: "2", label: "Q2 (Apr – Jun)" },
  { value: "3", label: "Q3 (Jul – Sep)" },
  { value: "4", label: "Q4 (Oct – Dec)" },
];

export default function CyclesPage() {
  const {
    workspace,
    selectedCycle,
    selectedOpenCycle,
    setSelectedCycleId,
    canManage,
    isAdmin,
    busy,
    send,
  } = useWorkspace();

  const [cycleName, setCycleName] = useState("");
  const [dateMode, setDateMode] = useState<"preset" | "custom">("preset");
  const [presetYear, setPresetYear] = useState(String(new Date().getFullYear()));
  const [presetQuarter, setPresetQuarter] = useState(String(Math.floor(new Date().getMonth() / 3) + 1));
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [requireApproval, setRequireApproval] = useState(false);
  const [checkInCadence, setCheckInCadence] = useState<CheckInCadence>("weekly");
  const [carryForwardOpen, setCarryForwardOpen] = useState(false);
  const [reflectionDraft, setReflectionDraft] = useState("");
  const [openReason, setOpenReason] = useState("Cycle review completed");
  const [reopenReason, setReopenReason] = useState("");

  useEffect(() => {
    if (selectedCycle) {
      setReflectionDraft(selectedCycle.finalReflection);
    } else {
      setReflectionDraft("");
    }
  }, [selectedCycle?.id, selectedCycle?.finalReflection]);

  async function createCycle(event: React.FormEvent) {
    event.preventDefault();
    const dates = dateMode === "preset"
      ? { preset: { year: Number(presetYear), quarter: Number(presetQuarter) } }
      : { startDate, endDate };
    const created = await send(
      "/api/cycles",
      "POST",
      { name: cycleName.trim() || undefined, ...dates, requireApproval, checkInCadence },
      "Cycle created as a draft.",
    );
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

  if (!workspace) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl lg:text-4xl">Cycles</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create, open, close and reopen OKR cycles with optimistic locking.</p>
        </div>
      </header>

      <CycleBanner />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Cycle setup
              <Badge className="bg-accent text-accent-foreground">Governance</Badge>
            </CardTitle>
            <CardDescription>Cycles start as drafts. Open one before adding objectives.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={createCycle}>
              <fieldset className="space-y-2" disabled={busy || !canManage}>
                <legend className="text-sm font-medium">Dates</legend>
                <RadioGroup value={dateMode} onValueChange={(value) => setDateMode(value as "preset" | "custom")} className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="cycle-mode-preset" value="preset" />
                    <Label htmlFor="cycle-mode-preset" className="font-normal">Quarter</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="cycle-mode-custom" value="custom" />
                    <Label htmlFor="cycle-mode-custom" className="font-normal">Custom dates</Label>
                  </div>
                </RadioGroup>
              </fieldset>
              {dateMode === "preset" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="cycle-year">Year</FieldLabel>
                    <Input id="cycle-year" type="number" min={2000} max={2100} step={1} value={presetYear} onChange={(event) => setPresetYear(event.target.value)} disabled={busy || !canManage} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cycle-quarter">Quarter</FieldLabel>
                    <Select value={presetQuarter} onValueChange={setPresetQuarter} disabled={busy || !canManage}>
                      <SelectTrigger id="cycle-quarter" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {QUARTERS.map((quarter) => <SelectItem key={quarter.value} value={quarter.value}>{quarter.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              ) : (
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
              )}
              <Field>
                <FieldLabel htmlFor="cycle-name">Name</FieldLabel>
                <Input
                  id="cycle-name"
                  required={dateMode === "custom"}
                  value={cycleName}
                  placeholder={dateMode === "preset" ? `Q${presetQuarter} ${presetYear}` : undefined}
                  onChange={(event) => setCycleName(event.target.value)}
                  disabled={busy || !canManage}
                />
                {dateMode === "preset" && <FieldDescription>Leave blank to use “Q{presetQuarter} {presetYear}”.</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel htmlFor="cycle-cadence">Check-in cadence</FieldLabel>
                <Select value={checkInCadence} onValueChange={(value) => setCheckInCadence(value as CheckInCadence)} disabled={busy || !canManage}>
                  <SelectTrigger id="cycle-cadence" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Every two weeks</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-1">
                  <Label htmlFor="cycle-require-approval">Require goal approval</Label>
                  <p className="text-xs text-muted-foreground">New goals wait for the owner's manager (or an admin) to approve them.</p>
                </div>
                <Switch id="cycle-require-approval" checked={requireApproval} onCheckedChange={setRequireApproval} disabled={busy || !canManage} />
              </div>
              <Button type="submit" disabled={busy || !canManage}>
                Create draft cycle
              </Button>
              {!canManage && <p className="text-xs text-muted-foreground">Managers and admins can create cycles.</p>}
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-none">
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

        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle>Carry forward</CardTitle>
            <CardDescription>Copy unfinished goals and their key results from one cycle into a draft or open cycle.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={busy || !canManage || workspace.cycles.length < 2}
              title={!canManage ? "Managers and admins can carry goals forward." : workspace.cycles.length < 2 ? "Create a second cycle to carry goals into." : undefined}
              onClick={() => setCarryForwardOpen(true)}
            >
              <CopyPlus aria-hidden="true" /> Carry forward goals
            </Button>
          </CardContent>
        </Card>
      </div>

      {carryForwardOpen && <CarryForwardDialog defaultSourceId={selectedCycle?.id ?? ""} onClose={() => setCarryForwardOpen(false)} />}
    </div>
  );
}
