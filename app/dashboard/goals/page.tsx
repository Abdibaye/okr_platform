"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  List,
  MessageSquareWarning,
  MoreHorizontal,
  MoreVertical,
  Network,
  Pencil,
  Plus,
  Search,
  Send,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CheckInModal, type CheckInDraft } from "@/components/okr/check-in-modal";
import { ApprovalBadge, GoalSheet, PersonCell } from "@/components/okr/goal-sheet";
import { formatDate, levelIcons, levelLabels, progressTone, statusLabels } from "@/components/okr/goal-utils";
import { KeyResultDialog } from "@/components/okr/key-result-dialog";
import { Progress } from "@/components/okr/progress";
import { useWorkspace } from "@/components/okr/workspace-context";
import type { GoalStatus, KeyResult, Objective } from "@/app/types";
import { cn } from "@/lib/utils";

const today = new Date().toISOString().slice(0, 10);
const ALL = "all";

type GoalTab = "mine" | "reports" | "team" | "company";

const tabLabels: Record<GoalTab, string> = {
  mine: "My Goals",
  reports: "My Direct Reports",
  team: "My Team",
  company: "Company Goals",
};

type SheetState = { objective: Objective | null } | null;
type KeyResultDialogState = { objective: Objective; keyResult: KeyResult | null } | null;

function metricValue(value: string) {
  return Number(value).toLocaleString();
}

function ProgressCell({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-sm text-muted-foreground">No KRs</span>;
  return (
    <div className="flex items-center gap-2">
      <Progress value={value} tone={progressTone(value)} className="w-24" aria-label={label} />
      <span className="text-xs font-medium tabular-nums">{Number(value.toFixed(2))}%</span>
    </div>
  );
}

export default function GoalsPage() {
  const { workspace, selectedCycle, setSelectedCycleId, busy, send, exportCycle } = useWorkspace();
  const [tab, setTab] = useState<GoalTab>("mine");
  const [ownerFilter, setOwnerFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "tree">("tree");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [krDialog, setKrDialog] = useState<KeyResultDialogState>(null);
  const [reviewTarget, setReviewTarget] = useState<Objective | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<Objective | null>(null);
  const [checkInKrId, setCheckInKrId] = useState<string | null>(null);
  const [checkInDrafts, setCheckInDrafts] = useState<Record<string, CheckInDraft>>({});
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);

  const cycles = useMemo(
    () => [...(workspace?.cycles ?? [])].sort((left, right) => left.startDate.localeCompare(right.startDate)),
    [workspace?.cycles],
  );
  const cycleIndex = cycles.findIndex((cycle) => cycle.id === selectedCycle?.id);
  const cycleObjectives = useMemo(() => selectedCycle?.objectives ?? [], [selectedCycle]);
  const objectiveById = useMemo(() => new Map(cycleObjectives.map((objective) => [objective.id, objective])), [cycleObjectives]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Objective[]>();
    for (const objective of cycleObjectives) {
      if (!objective.parentObjectiveId) continue;
      map.set(objective.parentObjectiveId, [...(map.get(objective.parentObjectiveId) ?? []), objective]);
    }
    return map;
  }, [cycleObjectives]);
  const memberById = useMemo(() => new Map((workspace?.members ?? []).map((member) => [member.id, member])), [workspace?.members]);
  const cycleClosed = selectedCycle?.status === "closed";

  // Notification links point at /dashboard/goals?goal=<id>; open that goal once the workspace has loaded.
  useEffect(() => {
    if (!workspace || deepLinkHandled) return;
    setDeepLinkHandled(true);
    const goalId = new URLSearchParams(window.location.search).get("goal");
    if (!goalId) return;
    const cycle = workspace.cycles.find((candidate) => candidate.objectives.some((objective) => objective.id === goalId));
    const objective = cycle?.objectives.find((candidate) => candidate.id === goalId);
    if (cycle && objective) {
      setSelectedCycleId(cycle.id);
      setSheet({ objective });
    }
  }, [workspace, deepLinkHandled, setSelectedCycleId]);

  useEffect(() => {
    setPage(1);
  }, [tab, ownerFilter, statusFilter, search, view, selectedCycle?.id, rowsPerPage]);

  const filtered = useMemo(() => {
    if (!workspace) return [];
    const user = workspace.user;
    const reports = new Set(user.directReportIds);
    const myTeams = new Set(user.teamIds);
    const query = search.trim().toLowerCase();
    return cycleObjectives.filter((objective) => {
      if (tab === "mine" && objective.ownerId !== user.id) return false;
      if (tab === "reports" && !(objective.ownerId && reports.has(objective.ownerId))) return false;
      if (tab === "team") {
        const ownerTeams = objective.ownerId ? memberById.get(objective.ownerId)?.teamIds ?? [] : [];
        const sharesTeam = (objective.teamId && myTeams.has(objective.teamId)) || ownerTeams.some((teamId) => myTeams.has(teamId));
        if (!sharesTeam) return false;
      }
      if (tab === "company" && objective.level !== "company") return false;
      if (ownerFilter !== ALL && objective.ownerId !== ownerFilter) return false;
      if (statusFilter === "pending_approval") {
        if (objective.approvalStatus !== "pending") return false;
      } else if (statusFilter !== ALL && objective.status !== statusFilter) return false;
      if (query && !objective.title.toLowerCase().includes(query) && !objective.keyResults.some((keyResult) => keyResult.title.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [workspace, cycleObjectives, tab, ownerFilter, statusFilter, search, memberById]);

  // Tree view nests matching goals under a matching parent; list view shows every match flat.
  const topLevel = useMemo(() => {
    if (view === "list") return filtered;
    const ids = new Set(filtered.map((objective) => objective.id));
    return filtered.filter((objective) => !objective.parentObjectiveId || !ids.has(objective.parentObjectiveId));
  }, [filtered, view]);

  const pageCount = Math.max(1, Math.ceil(topLevel.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const pageRows = topLevel.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const selectedCheckInKr = cycleObjectives.flatMap((objective) => objective.keyResults).find((keyResult) => keyResult.id === checkInKrId);
  const selectedCheckInDraft = selectedCheckInKr ? checkInDrafts[selectedCheckInKr.id] : undefined;

  // Re-resolve dialog targets from the latest workspace so versions stay fresh after reloads.
  const sheetObjective = sheet?.objective ? objectiveById.get(sheet.objective.id) ?? null : null;
  const krObjective = krDialog ? objectiveById.get(krDialog.objective.id) ?? krDialog.objective : null;
  const krTarget = krDialog?.keyResult ? krObjective?.keyResults.find((keyResult) => keyResult.id === krDialog.keyResult?.id) ?? krDialog.keyResult : null;

  function toggleExpanded(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  async function submitCheckIn(keyResult: KeyResult) {
    const draft = checkInDrafts[keyResult.id];
    if (!draft) return;
    const saved = await send(`/api/key-results/${keyResult.id}`, "PATCH", { current: Number(draft.current), version: keyResult.version }, "Key result updated.");
    if (saved) {
      const entry = `${draft.effectiveDate || today} · value ${metricValue(draft.current)} · ${draft.confidence.replace("_", " ")}`;
      setCheckInDrafts((previous) => ({ ...previous, [keyResult.id]: { ...draft, timeline: [entry, ...draft.timeline] } }));
      setCheckInKrId(null);
    }
  }

  async function approval(objective: Objective, action: "submit" | "approve" | "request_changes", note = "") {
    const messages = { submit: "Goal submitted for approval.", approve: "Goal approved.", request_changes: "Changes requested from the goal owner." };
    return send(`/api/objectives/${objective.id}/approval`, "POST", { action, note }, messages[action]);
  }

  async function confirmRequestChanges() {
    if (!reviewTarget) return;
    const done = await approval(reviewTarget, "request_changes", reviewNote);
    if (done) {
      setReviewTarget(null);
      setReviewNote("");
    }
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    const latest = objectiveById.get(archiveTarget.id) ?? archiveTarget;
    const done = await send(`/api/objectives/${latest.id}`, "PATCH", { version: latest.version, archived: true }, "Goal archived.");
    if (done) setArchiveTarget(null);
  }

  function goalActions(objective: Objective) {
    const writable = !cycleClosed;
    const canSubmit = writable && objective.canEdit && (
      objective.approvalStatus === "changes_requested" || (objective.approvalStatus === "not_required" && Boolean(selectedCycle?.requireApproval))
    );
    const canReview = writable && objective.canApprove && objective.approvalStatus === "pending";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${objective.title}`}><MoreVertical /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setSheet({ objective })}>
            <Pencil /> {writable && objective.canEdit ? "Edit" : "View details"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!writable || !objective.canEdit} onSelect={() => setKrDialog({ objective, keyResult: null })}>
            <Plus /> Add key result
          </DropdownMenuItem>
          {(canSubmit || canReview) && <DropdownMenuSeparator />}
          {canSubmit && (
            <DropdownMenuItem disabled={busy} onSelect={() => void approval(objective, "submit")}>
              <Send /> Submit for approval
            </DropdownMenuItem>
          )}
          {canReview && (
            <>
              <DropdownMenuItem disabled={busy} onSelect={() => void approval(objective, "approve")}>
                <CheckCircle2 /> Approve
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={() => { setReviewNote(""); setReviewTarget(objective); }}>
                <MessageSquareWarning /> Request changes
              </DropdownMenuItem>
            </>
          )}
          {writable && objective.canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiveTarget(objective)}>
                <Archive /> Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderKeyResultRow(objective: Objective, keyResult: KeyResult, depth: number) {
    const progress = Number(keyResult.progress);
    const writable = !cycleClosed;
    return (
      <TableRow key={`kr-${keyResult.id}`} className="bg-muted/20">
        <TableCell className="whitespace-normal">
          <div className="flex items-start gap-2" style={{ paddingLeft: `${depth * 1.5 + 1.75}rem` }}>
            <Target aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm">{keyResult.title}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {metricValue(keyResult.current)} of {metricValue(keyResult.target)} {keyResult.unit} · baseline {metricValue(keyResult.baseline)}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell>{keyResult.owner ? <PersonCell name={keyResult.owner.name} detail={keyResult.owner.jobTitle} /> : <span className="text-muted-foreground">—</span>}</TableCell>
        <TableCell><ProgressCell value={progress} label={`${keyResult.title} progress`} /></TableCell>
        <TableCell><span className="text-xs text-muted-foreground">Key result</span></TableCell>
        <TableCell className="tabular-nums">{formatDate(keyResult.dueDate)}</TableCell>
        <TableCell className="tabular-nums">{formatDate(keyResult.updatedAt)}</TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for key result ${keyResult.title}`}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!writable || !keyResult.canCheckIn} onSelect={() => openCheckIn(keyResult)}>
                <CheckCircle2 /> Check in
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!writable || !objective.canEdit} onSelect={() => setKrDialog({ objective, keyResult })}>
                <Pencil /> Edit key result
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  }

  function renderGoalRows(objective: Objective, depth: number, seen: Set<string>): React.ReactNode {
    const children = view === "tree" ? (childrenByParent.get(objective.id) ?? []).filter((child) => !seen.has(child.id)) : [];
    const expandable = objective.keyResults.length > 0 || children.length > 0;
    const isExpanded = expanded.has(objective.id);
    const LevelIcon = levelIcons[objective.level];
    const progress = objective.progress === null ? null : Number(objective.progress);
    const parent = objective.parentObjectiveId ? objectiveById.get(objective.parentObjectiveId) : undefined;
    const nextSeen = new Set(seen).add(objective.id);

    return (
      <Fragment key={objective.id}>
        <TableRow>
          <TableCell className="whitespace-normal">
            <div className="flex items-start gap-2" style={{ paddingLeft: `${depth * 1.5}rem` }}>
              {expandable ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mt-0.5"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Hide" : "Show"} key results${view === "tree" ? " and aligned goals" : ""} for ${objective.title}`}
                  onClick={() => toggleExpanded(objective.id)}
                >
                  <ChevronDown className={cn("transition-transform", isExpanded ? "" : "-rotate-90")} />
                </Button>
              ) : (
                <span className="size-6 shrink-0" aria-hidden="true" />
              )}
              <LevelIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-brand-teal" />
              <div className="min-w-0">
                <button
                  type="button"
                  className="text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => setSheet({ objective })}
                >
                  {objective.title}
                </button>
                <p className="text-xs text-muted-foreground">
                  <span className="sr-only">Level: </span>{levelLabels[objective.level]}
                  {objective.team && <> · {objective.team.name}</>}
                  {view === "list" && parent && <> · aligned to “{parent.title}”</>}
                  {objective.copiedFromObjectiveId && <> · carried forward</>}
                </p>
              </div>
            </div>
          </TableCell>
          <TableCell>
            {objective.owner ? <PersonCell name={objective.owner.name} detail={objective.owner.jobTitle} /> : <span className="text-muted-foreground">Unassigned</span>}
          </TableCell>
          <TableCell><ProgressCell value={progress} label={`${objective.title} progress`} /></TableCell>
          <TableCell>
            <div className="flex flex-wrap gap-1">
              <Badge variant={objective.status === "active" ? "default" : objective.status === "cancelled" ? "destructive" : "outline"}>{statusLabels[objective.status]}</Badge>
              <ApprovalBadge objective={objective} />
            </div>
          </TableCell>
          <TableCell className="tabular-nums">{formatDate(objective.dueDate)}</TableCell>
          <TableCell className="tabular-nums">{formatDate(objective.updatedAt)}</TableCell>
          <TableCell className="text-right">{goalActions(objective)}</TableCell>
        </TableRow>
        {isExpanded && objective.keyResults.map((keyResult) => renderKeyResultRow(objective, keyResult, depth))}
        {isExpanded && children.map((child) => renderGoalRows(child, depth + 1, nextSeen))}
      </Fragment>
    );
  }

  if (!workspace) return null;

  const owners = workspace.members.filter((member) => member.isActive);
  const createDisabledReason = !selectedCycle ? "Create a cycle first." : cycleClosed ? "This cycle is closed." : undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl lg:text-4xl">Goals</h1>
          <p className="mt-1 text-sm text-muted-foreground">Goals and key results for the selected cycle, aligned from company down to individuals.</p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Goal view">
          <Button variant={view === "list" ? "default" : "outline"} size="icon" aria-pressed={view === "list"} aria-label="List view" title="List view" onClick={() => setView("list")}>
            <List />
          </Button>
          <Button variant={view === "tree" ? "default" : "outline"} size="icon" aria-pressed={view === "tree"} aria-label="Alignment tree view" title="Alignment tree view" onClick={() => setView("tree")}>
            <Network />
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as GoalTab)}>
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" aria-label="Goal views">
            {(Object.keys(tabLabels) as GoalTab[]).map((key) => (
              <TabsTrigger key={key} value={key} className="px-3 uppercase tracking-wide text-xs">{tabLabels[key]}</TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <section aria-labelledby="goals-view-title" className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="goals-view-title" className="text-xl">{tabLabels[tab]}</h2>
          <div className="flex items-center gap-2">
            <Button disabled={Boolean(createDisabledReason)} title={createDisabledReason} onClick={() => setSheet({ objective: null })}>
              <Plus aria-hidden="true" /> Create goal
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More goal options"><MoreVertical /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!selectedCycle?.objectives.length} onSelect={exportCycle}>
                  <Download /> Export cycle as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-end">
          <div className="flex items-center gap-1" role="group" aria-label="Cycle">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous cycle"
              disabled={cycleIndex <= 0}
              onClick={() => setSelectedCycleId(cycles[cycleIndex - 1].id)}
            >
              <ChevronLeft />
            </Button>
            <Select value={selectedCycle?.id ?? ""} onValueChange={setSelectedCycleId} disabled={!cycles.length}>
              <SelectTrigger className="min-w-40" aria-label="Cycle"><SelectValue placeholder="No cycles" /></SelectTrigger>
              <SelectContent>
                {cycles.map((cycle) => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name} ({cycle.status})</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next cycle"
              disabled={cycleIndex === -1 || cycleIndex >= cycles.length - 1}
              onClick={() => setSelectedCycleId(cycles[cycleIndex + 1].id)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:flex xl:flex-1 xl:flex-wrap">
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-full xl:w-56" aria-label="Filter by owner"><SelectValue placeholder="Select an owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All owners</SelectItem>
                {owners.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full xl:w-48" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {(Object.keys(statusLabels) as GoalStatus[]).map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                <SelectItem value="pending_approval">Awaiting approval</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative xl:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search goals and key results" aria-label="Search goals and key results" className="pl-9" />
            </div>
          </div>
        </div>

        {selectedCycle && (
          <p className="text-xs text-muted-foreground">
            {formatDate(selectedCycle.startDate)} – {formatDate(selectedCycle.endDate)} · <span className="capitalize">{selectedCycle.status}</span>
            {selectedCycle.requireApproval && " · goals need manager approval"}
            {cycleClosed && " · closed cycles are read-only"}
          </p>
        )}

        <div className="rounded-xl border bg-card">
          <Table className="min-w-[60rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[34%]">Goal</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((objective) => renderGoalRows(objective, 0, new Set()))}
              {!pageRows.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {!selectedCycle ? "No cycle yet." : cycleObjectives.length ? "No goals match this view and filters." : "No goals in this cycle yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <nav className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end" aria-label="Goal pagination">
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="rows-per-page" className="text-muted-foreground">Rows per page</label>
            <Select value={String(rowsPerPage)} onValueChange={(value) => setRowsPerPage(Number(value))}>
              <SelectTrigger id="rows-per-page" size="sm" className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 25, 50].map((count) => <SelectItem key={count} value={String(count)}>{count}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="First page" disabled={currentPage === 1} onClick={() => setPage(1)}><ChevronsLeft /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
            <span className="px-2 text-sm tabular-nums" aria-live="polite">Page {currentPage} of {pageCount}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Last page" disabled={currentPage === pageCount} onClick={() => setPage(pageCount)}><ChevronsRight /></Button>
          </div>
        </nav>
      </section>

      {sheet && selectedCycle && (
        <GoalSheet
          key={sheet.objective?.id ?? "new"}
          cycle={selectedCycle}
          objective={sheet.objective ? sheetObjective ?? sheet.objective : null}
          onClose={() => setSheet(null)}
          onAddKeyResult={(objective) => setKrDialog({ objective, keyResult: null })}
          onEditKeyResult={(objective, keyResult) => setKrDialog({ objective, keyResult })}
        />
      )}

      {krDialog && krObjective && (
        <KeyResultDialog
          key={krDialog.keyResult?.id ?? `new-${krObjective.id}`}
          objective={krObjective}
          keyResult={krTarget}
          onClose={() => setKrDialog(null)}
        />
      )}

      <Dialog open={reviewTarget !== null} onOpenChange={(open) => { if (!open) setReviewTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>Tell the owner what to change in “{reviewTarget?.title}”. They'll be notified.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="review-note">What needs to change</FieldLabel>
            <Textarea id="review-note" value={reviewNote} maxLength={2000} onChange={(event) => setReviewNote(event.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button disabled={busy || !reviewNote.trim()} onClick={confirmRequestChanges}>Send request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveTarget !== null} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive goal?</DialogTitle>
            <DialogDescription>
              “{archiveTarget?.title}” and its key results will be archived. Goals aligned to it stay in the cycle but are no longer aligned. This can't be undone here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={confirmArchive}>Archive goal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedCheckInKr && selectedCheckInDraft && (
        <CheckInModal
          keyResult={selectedCheckInKr}
          draft={selectedCheckInDraft}
          busy={busy}
          onClose={() => setCheckInKrId(null)}
          onChange={(draft) => setCheckInDrafts((previous) => ({ ...previous, [selectedCheckInKr.id]: draft }))}
          onSubmit={() => submitCheckIn(selectedCheckInKr)}
        />
      )}
    </div>
  );
}
