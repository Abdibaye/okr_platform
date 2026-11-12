"use client";

import { cn } from "@/lib/utils";

export type ProgressTone = "default" | "on_track" | "at_risk" | "off_track" | "neutral";

const toneClasses: Record<ProgressTone, string> = {
  default: "bg-primary",
  on_track: "bg-success",
  at_risk: "bg-warning",
  off_track: "bg-destructive",
  neutral: "bg-muted-foreground/50",
};

interface ProgressProps {
  value: number | null;
  tone?: ProgressTone;
  className?: string;
  "aria-label": string;
}

export function Progress({
  value,
  tone = "default",
  className,
  "aria-label": ariaLabel,
}: ProgressProps) {
  const width = value === null ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn("h-1.5 w-full rounded-full bg-track", className)}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={value === null ? undefined : Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-all", toneClasses[tone])}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
