"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CycleBanner } from "@/components/okr/cycle-banner";
import { useWorkspace } from "@/components/okr/workspace-context";

const today = new Date().toISOString().slice(0, 10);

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
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
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
      </div>
    </div>
  );
}
