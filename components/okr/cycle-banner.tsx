"use client";

import { Download, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace } from "./workspace-context";

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function CycleBanner({
  search,
  onSearchChange,
  searchPlaceholder = "Search objectives and key results",
  showSearch = false,
}: {
  search?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  showSearch?: boolean;
}) {
  const { workspace, selectedCycleId, setSelectedCycleId, selectedCycle, exportCycle, canManage } = useWorkspace();
  const cycles = workspace?.cycles ?? [];

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
      <p className="flex flex-wrap items-center gap-2 text-sm italic text-muted-foreground">
        {selectedCycle ? (
          <>
            <span>Displaying data from {formatDate(selectedCycle.startDate)} to {formatDate(selectedCycle.endDate)}</span>
            <Badge variant="outline" className="not-italic capitalize">{selectedCycle.status}</Badge>
            <Badge variant="secondary" className="font-mono not-italic tabular-nums">v{selectedCycle.version}</Badge>
          </>
        ) : (
          <span>No cycle yet — {canManage ? "create one in Cycles to get started." : "ask a manager or admin to create one."}</span>
        )}
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center">
        <Select value={selectedCycleId} onValueChange={setSelectedCycleId} disabled={!cycles.length}>
          <SelectTrigger id="cycle-select" className="w-full" aria-label="Cycle">
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
        {showSearch && onSearchChange ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="pl-9 sm:min-w-64"
            />
          </div>
        ) : (
          <div />
        )}
        <Button variant="outline" onClick={exportCycle} disabled={!selectedCycle?.objectives.length}>
          <Download aria-hidden="true" /> Export CSV
        </Button>
      </div>
    </div>
  );
}
