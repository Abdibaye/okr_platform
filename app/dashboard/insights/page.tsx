"use client";

import { PeriodComparisonSection } from "@/components/okr/period-comparison";
import { useWorkspace } from "@/components/okr/workspace-context";

export default function InsightsPage() {
  const { workspace } = useWorkspace();

  if (!workspace) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl lg:text-4xl">Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">Compare progress, completion, and final reflections across cycles.</p>
        </div>
      </header>

      <section aria-labelledby="insights-title">
        <h2 id="insights-title" className="sr-only">Period comparisons</h2>
        <PeriodComparisonSection summaries={workspace.summaries} comparisons={workspace.comparisons} />
      </section>
    </div>
  );
}
