"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Cycle, GoalLevel, GoalStatus, GoalVisibility, KeyResult, Objective } from "@/app/types";
import { apiRequest, approvalLabels, describeSaveError, initials, levelLabels, selfAndDescendantIds, statusLabels } from "./goal-utils";
import { useWorkspace } from "./workspace-context";

const NONE = "none";

type Permission = "viewer" | "editor";

interface GoalDraft {
  title: string;
  description: string;
  level: GoalLevel;
  teamId: string;
  ownerId: string;
  dueDate: string;
  status: GoalStatus;
  parentObjectiveId: string;
  visibility: GoalVisibility;
  access: { userId: string; permission: Permission }[];
}

const visibilityOptions: { value: GoalVisibility; label: string; description: string }[] = [
  { value: "company", label: "Company", description: "Anyone in the company can view this goal." },
  { value: "team", label: "Team", description: "Members of the goal's team and managers can view it." },
  { value: "restricted", label: "Restricted", description: "Only the owner, their manager, admins and people you add below can view it." },
];

function draftFrom(objective: Objective): GoalDraft {
  return {
    title: objective.title,
    description: objective.description,
    level: objective.level,
    teamId: objective.teamId ?? NONE,
    ownerId: objective.ownerId ?? NONE,
    dueDate: objective.dueDate ?? "",
    status: objective.status,
    parentObjectiveId: objective.parentObjectiveId ?? NONE,
    visibility: objective.visibility,
    access: objective.access.map((entry) => ({ ...entry })),
  };
}

function idsWith(access: GoalDraft["access"], permission: Permission) {
  return access.filter((entry) => entry.permission === permission).map((entry) => entry.userId).sort();
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function nullable(value: string) {
  return value === NONE || value === "" ? null : value;
}

function Section({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b">
      <h3>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left text-base font-semibold hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={onToggle}
        >
          <span>{title}</span>
          <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            {summary}
            <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </button>
      </h3>
      <div id={`${id}-panel`} hidden={!open} className="space-y-4 px-6 pb-6">
        {children}
      </div>
    </section>
  );
}

export function GoalSheet({
  cycle,
  objective,
  onClose,
  onAddKeyResult,
  onEditKeyResult,
}: {
  cycle: Cycle;
  /** Goal being edited; null creates a new goal in `cycle`. */
  objective: Objective | null;
  onClose: () => void;
  onAddKeyResult: (objective: Objective) => void;
  onEditKeyResult: (objective: Objective, keyResult: KeyResult) => void;
}) {
  const { workspace, canManage, loadWorkspace, setFeedback } = useWorkspace();
  const userId = workspace?.user.id ?? "";
  const isCreate = objective === null;
  const [draft, setDraft] = useState<GoalDraft>(() => objective ? draftFrom(objective) : {
    title: "",
    description: "",
    level: canManage ? "team" : "individual",
    teamId: workspace?.user.teamIds[0] ?? NONE,
    ownerId: userId || NONE,
    dueDate: cycle.endDate,
    status: "active",
    parentObjectiveId: NONE,
    visibility: "company",
    access: [],
  });
  const [openSections, setOpenSections] = useState({ basics: true, privacy: isCreate, keyResults: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadAfterConflict, setReloadAfterConflict] = useState(false);
  const [newAccessUserId, setNewAccessUserId] = useState("");
  const [newAccessPermission, setNewAccessPermission] = useState<Permission>("viewer");

  // After a 409 the workspace reloads; show the latest saved values so the user can re-apply their change.
  useEffect(() => {
    if (reloadAfterConflict && objective) {
      setDraft(draftFrom(objective));
      setReloadAfterConflict(false);
    }
  }, [objective?.version]);

  const members = useMemo(() => (workspace?.members ?? []).filter((member) => member.isActive), [workspace?.members]);
  const memberById = useMemo(() => new Map((workspace?.members ?? []).map((member) => [member.id, member])), [workspace?.members]);
  const teams = workspace?.teams ?? [];
  const parentOptions = useMemo(() => {
    const excluded = objective ? selfAndDescendantIds(cycle.objectives, objective.id) : new Set<string>();
    return cycle.objectives.filter((candidate) => !excluded.has(candidate.id));
  }, [cycle.objectives, objective]);

  const cycleClosed = cycle.status === "closed";
  const canEditContent = !cycleClosed && (isCreate || Boolean(objective?.canEdit));
  const canEditPrivacy = !cycleClosed && (isCreate ? canManage : Boolean(objective?.canManage));
  // Members may only draft individual goals that they own.
  const lockedToSelf = isCreate && !canManage;
  const owner = memberById.get(nullable(draft.ownerId) ?? "");
  const accessCandidates = members.filter((member) =>
    member.id !== nullable(draft.ownerId) && !draft.access.some((entry) => entry.userId === member.id)
  );

  function update<K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function addAccess() {
    if (!newAccessUserId) return;
    update("access", [...draft.access, { userId: newAccessUserId, permission: newAccessPermission }]);
    setNewAccessUserId("");
  }

  function buildBody() {
    const fields = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      level: draft.level,
      teamId: nullable(draft.teamId),
      dueDate: draft.dueDate || null,
      status: draft.status,
      parentObjectiveId: nullable(draft.parentObjectiveId),
    };
    const privacy = {
      ownerId: nullable(draft.ownerId),
      visibility: draft.visibility,
      viewerIds: idsWith(draft.access, "viewer"),
      editorIds: idsWith(draft.access, "editor"),
    };
    if (!objective) return { cycleId: cycle.id, ...fields, ...(canEditPrivacy ? privacy : { ownerId: userId }) };

    const body: Record<string, unknown> = { version: objective.version };
    const before = draftFrom(objective);
    if (fields.title !== objective.title) body.title = fields.title;
    if (fields.description !== objective.description) body.description = fields.description;
    if (fields.level !== objective.level) body.level = fields.level;
    if (fields.teamId !== objective.teamId) body.teamId = fields.teamId;
    if (fields.dueDate !== objective.dueDate) body.dueDate = fields.dueDate;
    if (fields.status !== objective.status) body.status = fields.status;
    if (fields.parentObjectiveId !== objective.parentObjectiveId) body.parentObjectiveId = fields.parentObjectiveId;
    if (canEditPrivacy) {
      if (privacy.ownerId !== objective.ownerId) body.ownerId = privacy.ownerId;
      if (privacy.visibility !== objective.visibility) body.visibility = privacy.visibility;
      if (!sameIds(privacy.viewerIds, idsWith(before.access, "viewer")) || !sameIds(privacy.editorIds, idsWith(before.access, "editor"))) {
        body.viewerIds = privacy.viewerIds;
        body.editorIds = privacy.editorIds;
      }
    }
    return body;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!draft.title.trim()) {
      setOpenSections((previous) => ({ ...previous, basics: true }));
      setError("Give the goal a title.");
      return;
    }
    if ((draft.level === "team" || draft.visibility === "team") && nullable(draft.teamId) === null) {
      setOpenSections((previous) => ({ ...previous, basics: true }));
      setError(draft.level === "team" ? "Team goals need a team. Choose one under Basics." : "Choose a team under Basics before limiting privacy to that team.");
      return;
    }
    const body = buildBody();
    if (objective && Object.keys(body).length === 1) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const result = objective
        ? await apiRequest(`/api/objectives/${objective.id}`, "PATCH", body)
        : await apiRequest("/api/objectives", "POST", body);
      if (!result.ok) {
        setError(describeSaveError(result, "goal"));
        if (result.status === 409) {
          setReloadAfterConflict(true);
          await loadWorkspace();
        }
        return;
      }
      await loadWorkspace();
      setFeedback({ tone: "success", message: objective ? "Goal updated." : "Goal created." });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const visibilityLabel = visibilityOptions.find((option) => option.value === draft.visibility)?.label;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="top-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-xl data-[state=closed]:slide-out-to-right data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-right data-[state=open]:zoom-in-100"
      >
        <DialogHeader className="border-b px-6 py-5 text-left">
          <DialogTitle className="text-2xl font-normal">{isCreate ? "Create goal" : "Edit goal"}</DialogTitle>
          <DialogDescription>
            {cycle.name}
            {objective && <> · version {objective.version}</>}
            {cycleClosed && " · this cycle is closed, so the goal is read-only."}
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={save} noValidate>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Section
              id="goal-basics"
              title="Basics"
              summary={draft.title.trim() ? undefined : "Title required"}
              open={openSections.basics}
              onToggle={() => setOpenSections((previous) => ({ ...previous, basics: !previous.basics }))}
            >
              <Field>
                <FieldLabel htmlFor="goal-title">Title</FieldLabel>
                <Input id="goal-title" required maxLength={240} value={draft.title} onChange={(event) => update("title", event.target.value)} disabled={!canEditContent} />
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-description">Description</FieldLabel>
                <Textarea id="goal-description" value={draft.description} onChange={(event) => update("description", event.target.value)} disabled={!canEditContent} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="goal-level">Level</FieldLabel>
                  <Select value={draft.level} onValueChange={(value) => update("level", value as GoalLevel)} disabled={!canEditContent || lockedToSelf}>
                    <SelectTrigger id="goal-level" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(levelLabels) as GoalLevel[]).map((level) => (
                        <SelectItem key={level} value={level} disabled={level === "company" && !canManage && objective?.level !== "company"}>{levelLabels[level]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-team">Team</FieldLabel>
                  <Select value={draft.teamId} onValueChange={(value) => update("teamId", value)} disabled={!canEditContent}>
                    <SelectTrigger id="goal-team" className="w-full"><SelectValue placeholder="No team" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No team</SelectItem>
                      {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-owner">Owner</FieldLabel>
                  <Select value={draft.ownerId} onValueChange={(value) => update("ownerId", value)} disabled={!canEditPrivacy || lockedToSelf}>
                    <SelectTrigger id="goal-owner" className="w-full"><SelectValue placeholder="No owner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No owner</SelectItem>
                      {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!isCreate && !objective?.canManage && <FieldDescription>Only the owner, managers and admins can reassign this goal.</FieldDescription>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-due">Due date</FieldLabel>
                  <Input id="goal-due" type="date" value={draft.dueDate} onChange={(event) => update("dueDate", event.target.value)} disabled={!canEditContent} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-status">Status</FieldLabel>
                  <Select value={draft.status} onValueChange={(value) => update("status", value as GoalStatus)} disabled={!canEditContent}>
                    <SelectTrigger id="goal-status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(statusLabels) as GoalStatus[]).map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-parent">Aligned to</FieldLabel>
                  <Select value={draft.parentObjectiveId} onValueChange={(value) => update("parentObjectiveId", value)} disabled={!canEditContent}>
                    <SelectTrigger id="goal-parent" className="w-full"><SelectValue placeholder="Not aligned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not aligned</SelectItem>
                      {parentOptions.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>{levelLabels[candidate.level]} · {candidate.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>A goal can't align to itself or to one of its own child goals.</FieldDescription>
                </Field>
              </div>
            </Section>

            <Section
              id="goal-privacy"
              title="Privacy"
              summary={visibilityLabel ? `(${visibilityLabel})` : undefined}
              open={openSections.privacy}
              onToggle={() => setOpenSections((previous) => ({ ...previous, privacy: !previous.privacy }))}
            >
              <p className="text-sm text-muted-foreground">
                Viewers can see the goal. Editors can also edit it and its key results. Owners can edit and change privacy settings.
                The owner's manager and admins can always see the goal.
              </p>
              <RadioGroup
                value={draft.visibility}
                onValueChange={(value) => update("visibility", value as GoalVisibility)}
                disabled={!canEditPrivacy}
                aria-label="Who can view this goal"
              >
                {visibilityOptions.map((option) => (
                  <div key={option.value} className="flex items-start gap-3">
                    <RadioGroupItem id={`visibility-${option.value}`} value={option.value} className="mt-0.5" />
                    <Label htmlFor={`visibility-${option.value}`} className="block font-normal leading-snug">
                      <span className="font-semibold">{option.label}:</span> {option.description}
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Additional access</h4>
                {canEditPrivacy && (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                    <Select value={newAccessUserId} onValueChange={setNewAccessUserId}>
                      <SelectTrigger className="w-full" aria-label="Person to add"><SelectValue placeholder="Choose a person" /></SelectTrigger>
                      <SelectContent>
                        {accessCandidates.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={newAccessPermission} onValueChange={(value) => setNewAccessPermission(value as Permission)}>
                      <SelectTrigger className="w-full" aria-label="Access level for new person"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" onClick={addAccess} disabled={!newAccessUserId}><Plus aria-hidden="true" /> Add</Button>
                  </div>
                )}
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead className="w-32">Level</TableHead>
                        <TableHead className="w-16 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {owner ? (
                        <TableRow>
                          <TableCell><PersonCell name={owner.name} detail={owner.jobTitle} email={owner.email} /></TableCell>
                          <TableCell>Owner</TableCell>
                          <TableCell />
                        </TableRow>
                      ) : (
                        <TableRow>
                          <TableCell colSpan={3} className="text-sm text-muted-foreground">No owner assigned.</TableCell>
                        </TableRow>
                      )}
                      {draft.access.map((entry) => {
                        const member = memberById.get(entry.userId);
                        const name = member?.name ?? "Former member";
                        return (
                          <TableRow key={entry.userId}>
                            <TableCell><PersonCell name={name} detail={member?.jobTitle ?? ""} email={member?.email ?? ""} /></TableCell>
                            <TableCell>
                              <Select
                                value={entry.permission}
                                onValueChange={(value) => update("access", draft.access.map((item) => item.userId === entry.userId ? { ...item, permission: value as Permission } : item))}
                                disabled={!canEditPrivacy}
                              >
                                <SelectTrigger size="sm" className="w-full" aria-label={`Access level for ${name}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="viewer">Viewer</SelectItem>
                                  <SelectItem value="editor">Editor</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={!canEditPrivacy}
                                aria-label={`Remove ${name}`}
                                onClick={() => update("access", draft.access.filter((item) => item.userId !== entry.userId))}
                              >
                                <Trash2 />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {!canEditPrivacy && !cycleClosed && <p className="text-xs text-muted-foreground">Only the owner, managers and admins can change privacy.</p>}
              </div>
            </Section>

            {objective && (
              <Section
                id="goal-key-results"
                title="Key results"
                summary={`(${objective.keyResults.length})`}
                open={openSections.keyResults}
                onToggle={() => setOpenSections((previous) => ({ ...previous, keyResults: !previous.keyResults }))}
              >
                {objective.keyResults.length ? (
                  <ul className="divide-y rounded-lg border">
                    {objective.keyResults.map((keyResult) => (
                      <li key={keyResult.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{keyResult.title}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">{Number(keyResult.progress).toFixed(0)}% · target {Number(keyResult.target).toLocaleString()} {keyResult.unit}</p>
                        </div>
                        <Button type="button" variant="outline" size="sm" disabled={!canEditContent} onClick={() => onEditKeyResult(objective, keyResult)}>
                          <Pencil aria-hidden="true" /> Edit
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No key results yet, so this goal shows no progress percentage.</p>
                )}
                <Button type="button" variant="outline" disabled={!canEditContent} onClick={() => onAddKeyResult(objective)}>
                  <Plus aria-hidden="true" /> Add key result
                </Button>
              </Section>
            )}
          </div>

          <div className="space-y-3 border-t px-6 py-4">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Goal not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving || !canEditContent}>
                {saving ? "Saving…" : isCreate ? "Create goal" : "Save goal"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PersonCell({ name, detail, email }: { name: string; detail?: string; email?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        {email && <span className="block truncate text-xs text-muted-foreground">{email}</span>}
      </span>
    </div>
  );
}

export function ApprovalBadge({ objective }: { objective: Objective }) {
  if (objective.approvalStatus === "not_required") return null;
  const variant = objective.approvalStatus === "approved" ? "secondary" : objective.approvalStatus === "changes_requested" ? "destructive" : "outline";
  return <Badge variant={variant}>{approvalLabels[objective.approvalStatus]}</Badge>;
}
