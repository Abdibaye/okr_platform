"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/okr/progress";
import { compareCycleSummaries } from "@/server/okr-math";
import type { CycleSummary, PeriodComparison } from "@/app/types";

function formatDelta(value: number, suffix = "") {
  if (value > 0) return `+${value}${suffix}`;
  return `${value}${suffix}`;
}

function deltaVariant(value: number): "default" | "secondary" | "destructive" {
  if (value > 0) return "default";
  if (value < 0) return "destructive";
  return "secondary";
}

function progressTone(progress: number) {
  if (progress >= 70) return "on_track" as const;
  if (progress >= 40) return "at_risk" as const;
  return "off_track" as const;
}

export function PeriodComparisonSection({
  summaries,
  comparisons,
}: {
  summaries: CycleSummary[];
  comparisons: PeriodComparison[];
}) {
  const [baseId, setBaseId] = useState("");
  const [targetId, setTargetId] = useState("");

  useEffect(() => {
    if (summaries.length < 2) {
      setBaseId(summaries[0]?.id ?? "");
      setTargetId(summaries[0]?.id ?? "");
      return;
    }
    const validBase = summaries.some((summary) => summary.id === baseId);
    const validTarget = summaries.some((summary) => summary.id === targetId);
    if (!validBase) setBaseId(summaries[summaries.length - 2].id);
    if (!validTarget) setTargetId(summaries[summaries.length - 1].id);
  }, [summaries, baseId, targetId]);

  const baseSummary = summaries.find((summary) => summary.id === baseId) ?? summaries[0];
  const targetSummary = summaries.find((summary) => summary.id === targetId) ?? summaries[summaries.length - 1];
  const activeComparison = baseSummary && targetSummary ? compareCycleSummaries(baseSummary, targetSummary) : null;
  const sequentialByTarget = new Map(comparisons.map((item) => [item.targetCycleId, item]));

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle>Period comparisons</CardTitle>
        <CardDescription>Compare progress, completion, and final reflections across cycles.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {summaries.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Create at least two cycles to compare periods side by side.
          </p>
        ) : (
          activeComparison && baseSummary && targetSummary && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="compare-base">Baseline period</FieldLabel>
                  <Select value={baseSummary.id} onValueChange={setBaseId}>
                    <SelectTrigger id="compare-base" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {summaries.map((summary) => (
                        <SelectItem key={summary.id} value={summary.id}>
                          {summary.name} ({summary.startDate} – {summary.endDate})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="compare-target">Comparison period</FieldLabel>
                  <Select value={targetSummary.id} onValueChange={setTargetId}>
                    <SelectTrigger id="compare-target" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {summaries.map((summary) => (
                        <SelectItem key={summary.id} value={summary.id}>
                          {summary.name} ({summary.startDate} – {summary.endDate})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Average progress</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold tabular-nums">{targetSummary.averageProgress.toFixed(1)}%</span>
                    <Badge variant={deltaVariant(activeComparison.progressDelta)}>
                      {formatDelta(activeComparison.progressDelta, " pts")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">vs {baseSummary.averageProgress.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Objectives</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold tabular-nums">{targetSummary.objectiveCount}</span>
                    <Badge variant={deltaVariant(activeComparison.objectiveCountDelta)}>
                      {formatDelta(activeComparison.objectiveCountDelta)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">vs {baseSummary.objectiveCount}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Completed objectives</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold tabular-nums">{targetSummary.completedObjectives}</span>
                    <Badge variant={deltaVariant(activeComparison.completedObjectivesDelta)}>
                      {formatDelta(activeComparison.completedObjectivesDelta)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">vs {baseSummary.completedObjectives}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Key results</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold tabular-nums">{targetSummary.keyResultCount}</span>
                    <Badge variant={deltaVariant(activeComparison.keyResultCountDelta)}>
                      {formatDelta(activeComparison.keyResultCountDelta)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">vs {baseSummary.keyResultCount}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {[baseSummary, targetSummary].map((period, index) => (
                  <div key={`${period.id}-${index}`} className="space-y-2 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{period.name}</p>
                        <p className="text-xs text-muted-foreground">{period.startDate} → {period.endDate}</p>
                      </div>
                      <Badge variant="outline">{period.status}</Badge>
                    </div>
                    <Progress value={period.averageProgress} tone={progressTone(period.averageProgress)} aria-label={`${period.name} average progress`} />
                    <p className="text-xs text-muted-foreground">
                      Final reflection: {period.finalReflection || "No reflection recorded."}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Table className="min-w-[720px] border-border sm:min-w-0">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Objectives</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Key results</TableHead>
                <TableHead className="text-right">Avg progress</TableHead>
                <TableHead className="text-right">vs prior period</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((summary) => {
                const previousDelta = sequentialByTarget.get(summary.id);
                return (
                  <TableRow key={summary.id}>
                    <TableCell>
                      <p className="font-medium">{summary.name}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">{summary.startDate} → {summary.endDate}</p>
                    </TableCell>
                    <TableCell><Badge variant="outline">{summary.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{summary.objectiveCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.completedObjectives}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.keyResultCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.averageProgress.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">
                      {previousDelta ? (
                        <Badge variant={deltaVariant(previousDelta.progressDelta)}>
                          {formatDelta(previousDelta.progressDelta, " pts")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!summaries.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">No periods created yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
