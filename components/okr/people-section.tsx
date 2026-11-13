"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Role } from "@/app/types";

const NONE = "__none__";
const CSV_TEMPLATE = "email,name,role,manager_email,team_name,job_title,status\n";

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  managerName: string | null;
  jobTitle: string;
  isActive: boolean;
  deactivatedAt: string | null;
  directReportCount: number;
  teams: { id: string; name: string; isLead: boolean }[];
}

interface Team {
  id: string;
  name: string;
  description: string;
  leadUserId: string | null;
  members: { userId: string; name: string; email: string; isLead: boolean }[];
}

interface Invitation {
  id: string;
  email: string;
  name: string;
  role: Role;
  teamName: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  emailDeliveryStatus: "in_app_only" | "pending" | "sent" | "failed";
  emailError: string | null;
}

interface ImportResult {
  created: number;
  updated: number;
  invited: number;
  dryRun?: boolean;
  errors: { row: number; field: string; message: string }[];
  rows?: { row: number; email: string; action: "update" | "invite" | "unchanged" | "error"; changes: string[] }[];
  error?: string;
}

type Feedback = { tone: "success" | "error"; message: string; link?: string } | null;

const deliveryLabels: Record<Invitation["emailDeliveryStatus"], string> = {
  in_app_only: "Link only (no email set up)",
  pending: "Sending",
  sent: "Email sent",
  failed: "Email failed",
};

function MemberSelect({ id, value, onChange, members, placeholder, noneLabel, exclude }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  members: Member[];
  placeholder: string;
  noneLabel?: string;
  exclude?: string;
}) {
  return (
    <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
      <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {members.filter((member) => member.isActive && member.userId !== exclude).map((member) => (
          <SelectItem key={member.userId} value={member.userId}>{member.name} · {member.email}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PeopleSection({ role, currentUserId }: { role: Role; currentUserId: string }) {
  const isAdmin = role === "admin";
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState<Role>("member");
  const [editManager, setEditManager] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [deactivating, setDeactivating] = useState<Member | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [deactivateReason, setDeactivateReason] = useState("");

  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamLead, setTeamLead] = useState("");
  const [teamAdds, setTeamAdds] = useState<Record<string, string>>({});
  const [archivingTeam, setArchivingTeam] = useState<Team | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviteManager, setInviteManager] = useState("");
  const [inviteJobTitle, setInviteJobTitle] = useState("");

  const [csvText, setCsvText] = useState(CSV_TEMPLATE);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    const requests = [fetch("/api/members", { cache: "no-store" }), fetch("/api/teams", { cache: "no-store" })];
    if (isAdmin) requests.push(fetch("/api/invitations", { cache: "no-store" }));
    const responses = await Promise.all(requests);
    if (responses.some((response) => response.status === 401)) {
      window.location.href = "/?session=expired";
      return;
    }
    const [memberData, teamData, invitationData] = await Promise.all(responses.map((response) => response.json().catch(() => ({}))));
    const failed = responses.find((response) => !response.ok);
    if (failed) {
      setFeedback({ tone: "error", message: "Could not load people data. Reload to try again." });
      return;
    }
    setMembers(memberData.members ?? []);
    setTeams(teamData.teams ?? []);
    if (invitationData) setInvitations(invitationData.invitations ?? []);
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, method: string, body: unknown, successMessage: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401) {
        window.location.href = "/?session=expired";
        return null;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", message: data.error ?? "Request failed." });
        return null;
      }
      setFeedback({ tone: "success", message: successMessage, link: data.inviteUrl });
      await load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  function openEdit(member: Member) {
    setEditing(member);
    setEditRole(member.role);
    setEditManager(member.managerId ?? "");
    setEditJobTitle(member.jobTitle);
  }

  async function saveEdit() {
    if (!editing) return;
    const body: Record<string, unknown> = {};
    if (editRole !== editing.role) body.role = editRole;
    if ((editManager || null) !== editing.managerId) body.managerId = editManager || null;
    if (editJobTitle.trim() !== editing.jobTitle) body.jobTitle = editJobTitle;
    if (!Object.keys(body).length) {
      setEditing(null);
      return;
    }
    const saved = await send(`/api/members/${editing.id}`, "PATCH", body, `${editing.name} updated.`);
    if (saved) setEditing(null);
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    const saved = await send(`/api/members/${deactivating.id}`, "PATCH", {
      isActive: false,
      reassignToUserId: reassignTo || null,
      reason: deactivateReason.trim() || undefined,
    }, `${deactivating.name} deactivated. Their history is kept.`);
    if (saved) {
      setDeactivating(null);
      setReassignTo("");
      setDeactivateReason("");
    }
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    const created = await send("/api/teams", "POST", { name: teamName, description: teamDescription, leadUserId: teamLead || null }, "Team created.");
    if (created) {
      setTeamName("");
      setTeamDescription("");
      setTeamLead("");
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    const created = await send("/api/invitations", "POST", {
      email: inviteEmail,
      name: inviteName,
      role: inviteRole,
      teamId: inviteTeam || null,
      managerId: inviteManager || null,
      jobTitle: inviteJobTitle,
    }, `Invitation created for ${inviteEmail}.`);
    if (created) {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      setInviteTeam("");
      setInviteManager("");
      setInviteJobTitle("");
    }
  }

  async function runImport(dryRun: boolean) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/imports/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, dryRun }),
      });
      const data = await response.json().catch(() => ({})) as ImportResult;
      setImportResult(data);
      if (!response.ok) {
        setFeedback({ tone: "error", message: data.error ?? "Import failed." });
        return;
      }
      setFeedback({
        tone: data.errors.length ? "error" : "success",
        message: dryRun
          ? `Preview: ${data.updated} to update, ${data.invited} to invite, ${data.created} new teams, ${data.errors.length} rows with errors. Nothing has been saved yet.`
          : `Import finished: ${data.updated} updated, ${data.invited} invited, ${data.created} teams created, ${data.errors.length} rows skipped.`,
      });
      if (!dryRun) await load();
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setCsvText(await file.text());
    setImportResult(null);
  }

  const activeMembers = members.filter((member) => member.isActive);
  const sortedMembers = [...members].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));

  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>
          {isAdmin
            ? "Invite colleagues, set roles and reporting lines, organise teams and import staff from a spreadsheet."
            : "See who is in the workspace and organise teams."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <Alert variant={feedback.tone === "error" ? "destructive" : "default"}>
            <AlertTitle>{feedback.tone === "error" ? "Needs attention" : "Done"}</AlertTitle>
            <AlertDescription>
              <p>{feedback.message}</p>
              {feedback.link && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs">No email service is set up, so share this invite link directly:</span>
                  <code className="max-w-full break-all rounded bg-muted px-2 py-1 text-xs">{feedback.link}</code>
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(feedback.link ?? "")}>Copy link</Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="members">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="members">Members ({activeMembers.length})</TabsTrigger>
            <TabsTrigger value="teams">Teams ({teams.length})</TabsTrigger>
            {isAdmin && <TabsTrigger value="invitations">Invitations</TabsTrigger>}
            {isAdmin && <TabsTrigger value="import">Import CSV</TabsTrigger>}
          </TabsList>

          <TabsContent value="members" className="pt-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Teams</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedMembers.map((member) => (
                    <TableRow key={member.id} className={member.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell>
                        <p className="font-medium">{member.name}{member.userId === currentUserId ? " (you)" : ""}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </TableCell>
                      <TableCell>{member.jobTitle || "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{member.role}</Badge></TableCell>
                      <TableCell>{member.managerName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {member.teams.map((team) => (
                            <Badge key={team.id} variant="outline">{team.name}{team.isLead ? " · lead" : ""}</Badge>
                          ))}
                          {!member.teams.length && "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.isActive ? "default" : "outline"}>{member.isActive ? "Active" : "Deactivated"}</Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {member.isActive && <Button size="sm" variant="outline" onClick={() => openEdit(member)} disabled={busy}>Edit</Button>}
                            {member.isActive ? (
                              <Button size="sm" variant="ghost" onClick={() => setDeactivating(member)} disabled={busy || member.userId === currentUserId}>Deactivate</Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => send(`/api/members/${member.id}`, "PATCH", { isActive: true }, `${member.name} reactivated.`)} disabled={busy}>Reactivate</Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!members.length && (
                    <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="text-muted-foreground">No members loaded yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="teams" className="space-y-4 pt-2">
            <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end" onSubmit={createTeam}>
              <Field>
                <FieldLabel htmlFor="team-name">Team name</FieldLabel>
                <Input id="team-name" required maxLength={120} value={teamName} onChange={(event) => setTeamName(event.target.value)} disabled={busy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="team-description">Description</FieldLabel>
                <Input id="team-description" value={teamDescription} onChange={(event) => setTeamDescription(event.target.value)} disabled={busy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="team-lead">Team lead</FieldLabel>
                <MemberSelect id="team-lead" value={teamLead} onChange={setTeamLead} members={members} placeholder="No lead" noneLabel="No lead" />
              </Field>
              <Button type="submit" disabled={busy || !teamName.trim()}>Create team</Button>
            </form>

            <div className="grid gap-4 lg:grid-cols-2">
              {teams.map((team) => {
                const memberIds = new Set(team.members.map((member) => member.userId));
                const candidates = activeMembers.filter((member) => !memberIds.has(member.userId));
                return (
                  <div key={team.id} className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{team.name}</p>
                        {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setArchivingTeam(team)} disabled={busy}>Archive</Button>
                    </div>
                    <ul className="space-y-1">
                      {team.members.map((member) => (
                        <li key={member.userId} className="flex items-center justify-between gap-2 text-sm">
                          <span>
                            {member.name}
                            {member.isLead && <Badge className="ml-2" variant="secondary">Lead</Badge>}
                          </span>
                          <span className="flex items-center gap-1">
                            {!member.isLead && (
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(`/api/teams/${team.id}`, "PATCH", { leadUserId: member.userId }, `${member.name} is now lead of ${team.name}.`)}>
                                Make lead
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" aria-label={`Remove ${member.name} from ${team.name}`} disabled={busy} onClick={() => send(`/api/teams/${team.id}`, "PATCH", { removeMemberIds: [member.userId] }, `${member.name} removed from ${team.name}.`)}>
                              <X className="size-4" />
                            </Button>
                          </span>
                        </li>
                      ))}
                      {!team.members.length && <li className="text-sm text-muted-foreground">No members yet.</li>}
                    </ul>
                    {candidates.length > 0 && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <MemberSelect
                            id={`team-add-${team.id}`}
                            value={teamAdds[team.id] ?? ""}
                            onChange={(value) => setTeamAdds((current) => ({ ...current, [team.id]: value }))}
                            members={candidates}
                            placeholder="Add a member"
                          />
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy || !teamAdds[team.id]}
                          onClick={async () => {
                            const saved = await send(`/api/teams/${team.id}`, "PATCH", { addMemberIds: [teamAdds[team.id]] }, `Member added to ${team.name}.`);
                            if (saved) setTeamAdds((current) => ({ ...current, [team.id]: "" }));
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!teams.length && <p className="text-sm text-muted-foreground">No teams yet. Create one above.</p>}
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="invitations" className="space-y-4 pt-2">
              <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-3" onSubmit={sendInvite}>
                <Field>
                  <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                  <Input id="invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} disabled={busy} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="invite-name">Name</FieldLabel>
                  <Input id="invite-name" value={inviteName} onChange={(event) => setInviteName(event.target.value)} disabled={busy} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                  <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as Role)}>
                    <SelectTrigger id="invite-role" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="invite-team">Team</FieldLabel>
                  <Select value={inviteTeam || NONE} onValueChange={(value) => setInviteTeam(value === NONE ? "" : value)}>
                    <SelectTrigger id="invite-team" className="w-full"><SelectValue placeholder="No team" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No team</SelectItem>
                      {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="invite-manager">Manager</FieldLabel>
                  <MemberSelect id="invite-manager" value={inviteManager} onChange={setInviteManager} members={members} placeholder="No manager" noneLabel="No manager" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="invite-job-title">Job title</FieldLabel>
                  <Input id="invite-job-title" value={inviteJobTitle} onChange={(event) => setInviteJobTitle(event.target.value)} disabled={busy} />
                </Field>
                <div className="md:col-span-3">
                  <Button type="submit" disabled={busy || !inviteEmail.trim()}>Send invitation</Button>
                </div>
              </form>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invitee</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((invitation) => (
                      <TableRow key={invitation.id}>
                        <TableCell>
                          <p className="font-medium">{invitation.name || invitation.email}</p>
                          {invitation.name && <p className="text-xs text-muted-foreground">{invitation.email}</p>}
                        </TableCell>
                        <TableCell>{invitation.role}</TableCell>
                        <TableCell>{invitation.teamName ?? "—"}</TableCell>
                        <TableCell><Badge variant={invitation.status === "pending" ? "default" : "outline"}>{invitation.status}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={invitation.emailDeliveryStatus === "failed" ? "destructive" : "secondary"}>
                            {deliveryLabels[invitation.emailDeliveryStatus]}
                          </Badge>
                          {invitation.emailError && <p className="mt-1 text-xs text-destructive">{invitation.emailError}</p>}
                        </TableCell>
                        <TableCell className="tabular-nums">{new Date(invitation.expiresAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {(invitation.status === "pending" || invitation.status === "expired") && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => send(`/api/invitations/${invitation.id}/resend`, "POST", null, `Invitation resent to ${invitation.email}.`)}>
                                Resend
                              </Button>
                            )}
                            {invitation.status === "pending" && (
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(`/api/invitations/${invitation.id}`, "DELETE", null, `Invitation for ${invitation.email} revoked.`)}>
                                Revoke
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!invitations.length && (
                      <TableRow><TableCell colSpan={7} className="text-muted-foreground">No invitations yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="import" className="space-y-4 pt-2">
              <Field>
                <FieldLabel htmlFor="csv-file">Upload a CSV file</FieldLabel>
                <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} disabled={busy} />
                <FieldDescription>
                  Columns: email, name, role (admin/manager/member), manager_email, team_name, job_title, status (active/inactive).
                  Existing people are updated; new emails get an invitation. Blank cells leave existing values unchanged.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="csv-text">Or paste CSV</FieldLabel>
                <Textarea id="csv-text" rows={8} className="font-mono text-xs" value={csvText} onChange={(event) => { setCsvText(event.target.value); setImportResult(null); }} disabled={busy} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => runImport(true)} disabled={busy || !csvText.trim()}>Preview changes</Button>
                <Button onClick={() => runImport(false)} disabled={busy || !importResult?.dryRun || !importResult.rows?.some((row) => row.action === "update" || row.action === "invite")}>
                  Import
                </Button>
              </div>
              {!importResult?.dryRun && <p className="text-xs text-muted-foreground">Preview the file first; rows with errors are skipped on import.</p>}

              {importResult && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{importResult.dryRun ? "Preview" : "Imported"}</Badge>
                    <Badge variant="outline">Updated: {importResult.updated}</Badge>
                    <Badge variant="outline">Invited: {importResult.invited}</Badge>
                    <Badge variant="outline">Teams created: {importResult.created}</Badge>
                    <Badge variant={importResult.errors.length ? "destructive" : "outline"}>Errors: {importResult.errors.length}</Badge>
                  </div>
                  {importResult.errors.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Problem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.errors.map((error, index) => (
                          <TableRow key={`${error.row}-${error.field}-${index}`}>
                            <TableCell className="tabular-nums">{error.row}</TableCell>
                            <TableCell><code className="text-xs">{error.field}</code></TableCell>
                            <TableCell>{error.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {importResult.rows && importResult.rows.some((row) => row.action !== "error") && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Changes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.rows.filter((row) => row.action !== "error").map((row) => (
                          <TableRow key={row.row}>
                            <TableCell className="tabular-nums">{row.row}</TableCell>
                            <TableCell>{row.email}</TableCell>
                            <TableCell><Badge variant="secondary">{row.action}</Badge></TableCell>
                            <TableCell className="text-sm">{row.changes.join(", ") || "No changes"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
            <DialogDescription>Change role, reporting line or job title.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="edit-role">Role</FieldLabel>
              <Select value={editRole} onValueChange={(value) => setEditRole(value as Role)}>
                <SelectTrigger id="edit-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-manager">Manager</FieldLabel>
              <MemberSelect id="edit-manager" value={editManager} onChange={setEditManager} members={members} placeholder="No manager" noneLabel="No manager" exclude={editing?.userId} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-job-title">Job title</FieldLabel>
              <Input id="edit-job-title" maxLength={160} value={editJobTitle} onChange={(event) => setEditJobTitle(event.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deactivating)} onOpenChange={(open) => { if (!open) setDeactivating(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {deactivating?.name}?</DialogTitle>
            <DialogDescription>
              They will lose access to the workspace. Their check-ins, comments and audit history are kept, and you can reactivate them later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="reassign-to">Hand over their objectives and key results to</FieldLabel>
              <MemberSelect id="reassign-to" value={reassignTo} onChange={setReassignTo} members={members} placeholder="Keep current ownership" noneLabel="Keep current ownership" exclude={deactivating?.userId} />
            </Field>
            <Field>
              <FieldLabel htmlFor="deactivate-reason">Reason (optional)</FieldLabel>
              <Input id="deactivate-reason" value={deactivateReason} onChange={(event) => setDeactivateReason(event.target.value)} placeholder="e.g. Left the company" />
            </Field>
            {Boolean(deactivating?.directReportCount) && (
              <p className="text-sm text-muted-foreground">
                {deactivating?.name} manages {deactivating?.directReportCount} people; update their manager afterwards.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivating(null)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeactivate} disabled={busy}>Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archivingTeam)} onOpenChange={(open) => { if (!open) setArchivingTeam(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archivingTeam?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The team is hidden from lists. Its goals and history stay intact.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async () => {
                if (archivingTeam) await send(`/api/teams/${archivingTeam.id}`, "DELETE", null, `${archivingTeam.name} archived.`);
                setArchivingTeam(null);
              }}
            >
              Archive team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
