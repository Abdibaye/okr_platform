"use client";

import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cycle, CycleSummary, Objective, PeriodComparison } from "@/app/types";

type Status = "on_track" | "at_risk" | "off_track" | "no_krs";

const statusMeta: Record<Status, { label: string; segment: string; dot: string; ink: string }> = {
  on_track: { label: "On track", segment: "bg-rag-on-track/30", dot: "bg-rag-on-track", ink: "text-rag-on-track-ink" },
  at_risk: { label: "At risk", segment: "bg-rag-at-risk/35", dot: "bg-rag-at-risk", ink: "text-rag-at-risk-ink" },
  off_track: { label: "Off track", segment: "bg-rag-off-track/25", dot: "bg-rag-off-track", ink: "text-rag-off-track-ink" },
  no_krs: { label: "No key results", segment: "bg-rag-neutral-bg", dot: "bg-muted-foreground/50", ink: "text-rag-neutral-ink" },
};

const statusOrder: Status[] = ["on_track", "at_risk", "off_track", "no_krs"];

export function objectiveProgressValue(objective: Objective) {
  return objective.keyResults.length && objective.progress !== null ? Number(objective.progress) : null;
}

function objectiveStatus(objective: Objective): Status {
  const progress = objectiveProgressValue(objective);
  if (progress === null) return "no_krs";
  if (progress >= 70) return "on_track";
  if (progress >= 40) return "at_risk";
  return "off_track";
}

function formatPercent(value: number | null) {
  if (value === null) return "No KRs";
  return `${Math.round(value)}%`;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <h2 className="flex flex-col gap-1 text-xl font-semibold sm:flex-row sm:items-baseline sm:gap-3">
      <span className="shrink-0">{title}</span>
      <span aria-hidden="true" className="hidden text-muted-foreground/60 sm:inline">|</span>
      <span className="text-sm font-normal tracking-normal text-muted-foreground">{description}</span>
    </h2>
  );
}

function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-sm text-muted-foreground">No comparable progress {label}</span>;
  if (value === 0) return <span className="text-sm text-muted-foreground">No change {label}</span>;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Icon className={cn("size-4", up ? "text-rag-on-track-ink" : "text-rag-off-track-ink")} aria-hidden="true" />
      <span className={cn("font-semibold tabular-nums", up ? "text-rag-on-track-ink" : "text-rag-off-track-ink")}>
        {up ? "+" : "−"}{Math.abs(Math.round(value))} pts
      </span>
      {label}
    </span>
  );
}

const CHART_HEIGHT = 220;
const PLOT_TOP = 32;
const PLOT_BOTTOM = 176;
const Y_TICKS = [0, 25, 50, 75, 100];

function yFor(value: number) {
  const clamped = Math.min(100, Math.max(0, value));
  return PLOT_BOTTOM - (clamped / 100) * (PLOT_BOTTOM - PLOT_TOP);
}

function ProgressTrendChart({ summaries, selectedId }: { summaries: CycleSummary[]; selectedId?: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!summaries.length) {
    return <p className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground">Progress history appears once cycles exist.</p>;
  }
  const xFor = (index: number) => (summaries.length === 1 ? 50 : 6 + (index * 88) / (summaries.length - 1));
  const points = summaries.map((summary, index) => ({ summary, x: xFor(index), y: yFor(summary.averageProgress ?? 0) }));
  const lastIndex = points.length - 1;
  const hoveredPoint = hovered === null ? null : points[hovered];

  return (
    <figure className="m-0 min-w-0">
      <figcaption className="sr-only">Average objective progress by cycle</figcaption>
      <div className="flex">
        <div className="relative w-10 shrink-0" style={{ height: CHART_HEIGHT }} aria-hidden="true">
          {Y_TICKS.map((tick) => (
            <span key={tick} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: yFor(tick) }}>
              {tick}%
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg width="100%" height={CHART_HEIGHT} role="img" aria-label="Line chart of average objective progress for each cycle" className="overflow-visible">
            {Y_TICKS.map((tick) => (
              <line key={tick} x1="0" x2="100%" y1={yFor(tick)} y2={yFor(tick)} className={tick === 0 ? "stroke-border" : "stroke-border/60"} strokeWidth={1} />
            ))}
            {points.slice(1).map((point, index) => (
              <line
                key={point.summary.id}
                x1={`${points[index].x}%`}
                y1={points[index].y}
                x2={`${point.x}%`}
                y2={point.y}
                className="stroke-brand-teal-ink"
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={point.summary.status === "draft" ? "6 6" : undefined}
              />
            ))}
            {points.map((point, index) => {
              const emphasised = point.summary.id === selectedId || index === lastIndex;
              return (
                <g key={point.summary.id}>
                  {emphasised && (
                    <text x={`${point.x}%`} y={point.y - 14} textAnchor="middle" className="fill-brand-teal-ink text-sm font-semibold tabular-nums">
                      {formatPercent(point.summary.averageProgress)}
                    </text>
                  )}
                  <circle
                    cx={`${point.x}%`}
                    cy={point.y}
                    r={point.summary.id === selectedId ? 6 : 4.5}
                    className="fill-brand-teal-ink stroke-card"
                    strokeWidth={2}
                  />
                  <circle
                    cx={`${point.x}%`}
                    cy={point.y}
                    r={16}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${point.summary.name}: ${formatPercent(point.summary.averageProgress)} average progress`}
                    className="cursor-default outline-none focus-visible:stroke-ring"
                    strokeWidth={3}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(null)}
                  />
                  <text x={`${point.x}%`} y={CHART_HEIGHT - 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    {point.summary.name.length > 16 ? `${point.summary.name.slice(0, 15)}…` : point.summary.name}
                  </text>
                </g>
              );
            })}
          </svg>
          {hoveredPoint && (
            <div
              className="pointer-events-none absolute z-10 w-max max-w-56 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-pop"
              style={{ left: `${hoveredPoint.x}%`, top: hoveredPoint.y - 12 }}
            >
              <p className="font-semibold">{hoveredPoint.summary.name}</p>
              <p className="text-muted-foreground">{hoveredPoint.summary.startDate} – {hoveredPoint.summary.endDate}</p>
              <p className="mt-1 tabular-nums">
                {formatPercent(hoveredPoint.summary.averageProgress)} average · {hoveredPoint.summary.objectiveCount} objectives
              </p>
            </div>
          )}
        </div>
      </div>
      <table className="sr-only">
        <caption>Average progress by cycle</caption>
        <thead><tr><th scope="col">Cycle</th><th scope="col">Dates</th><th scope="col">Average progress</th></tr></thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={summary.id}>
              <td>{summary.name}</td>
              <td>{summary.startDate} – {summary.endDate}</td>
              <td>{formatPercent(summary.averageProgress)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function ObjectiveList({ title, objectives, emptyText, showStatus }: {
  title: string;
  objectives: Objective[];
  emptyText: string;
  showStatus?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {objectives.length ? (
        <ul className="space-y-2">
          {objectives.map((objective) => {
            const progress = objectiveProgressValue(objective);
            const status = objectiveStatus(objective);
            return (
              <li key={objective.id}>
                <a
                  href={`#objective-${objective.id}`}
                  className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{objective.title}</span>
                  <span className="shrink-0 text-base font-semibold tabular-nums text-brand-teal-ink">
                    {progress === null ? "—" : formatPercent(progress)}
                  </span>
                  {showStatus && (
                    <span className={cn("hidden w-24 shrink-0 items-center justify-end gap-1.5 text-xs sm:inline-flex", statusMeta[status].ink)}>
                      <span className={cn("size-2 rounded-full", statusMeta[status].dot)} aria-hidden="true" />
                      {statusMeta[status].label}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

export function DashboardOverview({ cycle, summaries, comparisons, teamCount }: {
  cycle?: Cycle;
  summaries: CycleSummary[];
  comparisons: PeriodComparison[];
  teamCount: number | null;
}) {
  const objectives = cycle?.objectives ?? [];
  const keyResultCount = objectives.reduce((total, objective) => total + objective.keyResults.length, 0);
  const summary = summaries.find((item) => item.id === cycle?.id);
  const comparison = comparisons.find((item) => item.targetCycleId === cycle?.id);
  const hasProgress = objectives.some((objective) => objectiveProgressValue(objective) !== null);

  const counts = statusOrder.map((status) => ({
    status,
    count: objectives.filter((objective) => objectiveStatus(objective) === status).length,
  }));
  const onTrackShare = objectives.length ? (counts[0].count / objectives.length) * 100 : 0;

  const withProgress = objectives
    .filter((objective) => objectiveProgressValue(objective) !== null)
    .sort((a, b) => (objectiveProgressValue(b) ?? 0) - (objectiveProgressValue(a) ?? 0));
  const top = withProgress.filter((objective) => (objectiveProgressValue(objective) ?? 0) >= 40).slice(0, 3);
  const attention = [
    ...objectives.filter((objective) => objectiveStatus(objective) === "no_krs"),
    ...[...withProgress].reverse().filter((objective) => (objectiveProgressValue(objective) ?? 0) < 70),
  ].filter((objective) => !top.includes(objective)).slice(0, 3);

  const meta = [
    `${objectives.length} ${objectives.length === 1 ? "objective" : "objectives"}`,
    `${keyResultCount} key ${keyResultCount === 1 ? "result" : "results"}`,
    ...(teamCount === null ? [] : [`${teamCount} ${teamCount === 1 ? "team" : "teams"}`]),
  ];

  return (
    <div className="space-y-12 rounded-xl border bg-card p-5 sm:p-8 lg:p-10">
      <section aria-labelledby="overall-progress-title" className="space-y-6">
        <div className="space-y-1.5">
          <div id="overall-progress-title">
            <SectionHeading title="Overall progress" description="Average progress of every objective in this cycle, based on its key results' latest check-ins." />
          </div>
          <p className="text-sm text-muted-foreground">{meta.join(" • ")}</p>
        </div>
        <div className="grid gap-8 lg:grid-cols-[16rem_1fr] lg:items-center">
          <div className="space-y-2">
            <p className="font-heading text-6xl font-semibold tracking-tight text-brand-teal-ink tabular-nums sm:text-7xl">
              {hasProgress && summary ? formatPercent(summary.averageProgress) : "—"}
            </p>
            {comparison ? (
              <span title={`Compared with ${comparison.baseCycleName}`}>
                <Delta value={comparison.progressDelta} label="vs previous period" />
              </span>
            ) : (
              <p className="text-sm text-muted-foreground">
                {hasProgress ? "No earlier period to compare yet" : "Add key results to start tracking progress"}
              </p>
            )}
          </div>
          <ProgressTrendChart summaries={summaries} selectedId={cycle?.id} />
        </div>
      </section>

      <section aria-labelledby="status-distribution-title" className="space-y-6">
        <div className="space-y-1.5">
          <div id="status-distribution-title">
            <SectionHeading title="Status distribution" description="How this cycle's objectives are tracking: on track at 70% or more, at risk at 40–69%, off track below 40%." />
          </div>
          <p className="text-sm text-muted-foreground">{counts[0].count} of {objectives.length} objectives on track</p>
        </div>
        {objectives.length ? (
          <div className="grid gap-6 lg:grid-cols-[16rem_1fr] lg:items-center">
            <p className="font-heading text-6xl font-semibold tracking-tight text-brand-teal-ink tabular-nums">
              {formatPercent(onTrackShare)}
              <span className="sr-only"> of objectives on track</span>
            </p>
            <div className="space-y-3">
              <div className="flex h-12 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label={counts.map(({ status, count }) => `${statusMeta[status].label}: ${count}`).join(", ")}>
                {counts.filter(({ count }) => count > 0).map(({ status, count }) => {
                  const share = (count / objectives.length) * 100;
                  return (
                    <div
                      key={status}
                      className={cn("grid min-w-1 place-items-center text-xs font-semibold tabular-nums first:rounded-l-md last:rounded-r-md", statusMeta[status].segment, statusMeta[status].ink)}
                      style={{ width: `${share}%` }}
                      title={`${statusMeta[status].label}: ${count} (${formatPercent(share)})`}
                    >
                      {share >= 8 && formatPercent(share)}
                    </div>
                  );
                })}
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {counts.map(({ status, count }) => (
                  <li key={status} className="inline-flex items-center gap-1.5">
                    <span className={cn("size-2.5 rounded-full", statusMeta[status].dot)} aria-hidden="true" />
                    {statusMeta[status].label}
                    <span className="font-semibold tabular-nums text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {cycle ? "No objectives in this cycle yet." : "Create a cycle to see how objectives are tracking."}
          </p>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ObjectiveList title="Top-performing objectives" objectives={top} emptyText="No objectives at 40% or more yet." />
        <ObjectiveList title="Needs attention" objectives={attention} emptyText="Nothing needs attention right now." showStatus />
      </div>
    </div>
  );
}
