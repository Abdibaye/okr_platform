"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CycleBanner } from "@/components/okr/cycle-banner";
import { DashboardOverview } from "@/components/okr/dashboard-overview";
import { useWorkspace } from "@/components/okr/workspace-context";

export default function DashboardHomePage() {
  const router = useRouter();
  const { workspace, selectedCycle, teamCount, canManage } = useWorkspace();

  // Backwards compatibility for any bookmarked hash URLs
  useEffect(() => {
    const hash = window.location.hash.toLowerCase();
    if (hash === "#team" || hash === "#people") router.replace("/dashboard/team");
    else if (hash === "#my-goals" || hash === "#goals") router.replace("/dashboard/goals");
    else if (hash === "#company-okrs" || hash === "#cycles") router.replace("/dashboard/cycles");
    else if (hash === "#alignment" || hash === "#insights") router.replace("/dashboard/insights");
    else if (hash === "#reports" || hash === "#activity") router.replace("/dashboard/activity");
  }, [router]);

  if (!workspace) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl lg:text-4xl">Home</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{workspace.company.name} · OKR workspace</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/dashboard/goals">
              <Target aria-hidden="true" /> View goals
            </Link>
          </Button>
          {canManage && (
            <Button variant="outline" asChild>
              <Link href="/dashboard/team">
                <Users aria-hidden="true" /> Manage team
              </Link>
            </Button>
          )}
        </div>
      </header>

      <CycleBanner />

      <section aria-labelledby="overview-title">
        <h2 id="overview-title" className="sr-only">Cycle Overview</h2>
        <DashboardOverview
          cycle={selectedCycle}
          summaries={workspace.summaries}
          comparisons={workspace.comparisons}
          teamCount={teamCount}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5">
        <div>
          <h3 className="text-base font-semibold">Ready to update your progress?</h3>
          <p className="text-sm text-muted-foreground">Check in on key results, align with company priorities, and review reflections.</p>
        </div>
        <Button variant="secondary" asChild>
          <Link href="/dashboard/goals" className="inline-flex items-center gap-1.5">
            Go to Goals <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
