"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { AddUsers, deliveryLabels } from "@/components/okr/add-users";
import { UserTable } from "@/components/okr/user-table";
import { splitName } from "@/lib/people";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Role } from "@/app/types";

const NONE = "__none__";

interface Member {
  id: string;
  userId: string;
  name: string;
  nameEditable: boolean;
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

type Feedback = { tone: "success" | "error"; message: string; link?: string } | null;

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
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("members");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editTeams, setEditTeams] = useState<string[]>([]);
  const [editConfirm, setEditConfirm] = useState(false);

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


  const load = useCallback(async () => {
    setLoading(true);
    try {
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
    } catch {
      setFeedback({ tone: "error", message: "Could not load people data. Check your connection and try again." });
    } finally { setLoading(false); }
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
      const delivery = data.invitation?.emailDeliveryStatus;
      setFeedback({ tone: "success", message: `${successMessage}${delivery ? ` ${deliveryLabels[delivery] ?? deliveryLabels.unknown}.` : ""}`, link: data.inviteUrl });
      await load();
      return data;
    } catch {
      setFeedback({ tone: "error", message: "Connection interrupted. The change could not be confirmed; reload before retrying." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openEdit(member: Member) {
    setFeedback(null);
    setEditing(member);
    setEditFirstName(splitName(member.name).firstName);
    setEditLastName(splitName(member.name).lastName);
    setEditActive(member.isActive);
    setEditTeams(member.teams.map((team) => team.id));
    setReassignTo("");
    setDeactivateReason("");
    setEditRole(member.role);
    setEditManager(member.managerId ?? "");
    setEditJobTitle(member.jobTitle);
  }

  async function saveEdit(confirmed = false) {
    if (!editing) return;
    if (!editActive && editing.isActive && !confirmed) { setEditConfirm(true); return; }
    const body: Record<string, unknown> = {};
    const name = [editFirstName.trim(), editLastName.trim()].filter(Boolean).join(" ");
    if (editing.nameEditable && name !== editing.name) body.name = name;
    if (editActive !== editing.isActive) {
      body.isActive = editActive;
      if (!editActive) { body.reassignToUserId = reassignTo || null; body.reason = deactivateReason.trim() || undefined; }
    }
    if ([...editTeams].sort().join(",") !== editing.teams.map((team) => team.id).sort().join(",")) body.teamIds = editTeams;
    if (editRole !== editing.role) body.role = editRole;
    if ((editManager || null) !== editing.managerId) body.managerId = editManager || null;
    if (editJobTitle.trim() !== editing.jobTitle) body.jobTitle = editJobTitle;
    if (!Object.keys(body).length) {
      setEditing(null);
      return;
    }
    const saved = await send(`/api/members/${editing.id}`, "PATCH", body, `${editing.name} updated.`);
    if (saved) { setEditing(null); setEditConfirm(false); }
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

  const activeMembers = members.filter((member) => member.isActive);
  const lastAdmin = editing?.role === "admin" && editing.isActive && activeMembers.filter((member) => member.role === "admin").length <= 1;

  if (adding && isAdmin) return <AddUsers onChanged={load} onFinish={() => { setAdding(false); setTab("members"); setFeedback(null); }} />;

  return (
    <section className="space-y-6" aria-labelledby="user-management-title">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 id="user-management-title" className="text-3xl lg:text-4xl">User Management</h1><p className="mt-2 text-sm text-muted-foreground">Manage your workspace’s people and access.</p></div>
        {isAdmin && <Button onClick={() => setAdding(true)}><Plus />Add users</Button>}
      </header>
      <div className="space-y-4">
        {feedback && (
          <Alert variant={feedback.tone === "error" ? "destructive" : "default"}>
            <AlertTitle>{feedback.tone === "error" ? "Needs attention" : "Done"}</AlertTitle>
            <AlertDescription>
              <p>{feedback.message}</p>
              {feedback.tone === "error" && <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>Reload people</Button>}
              {feedback.link && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs">Share this invitation link directly if email was not delivered:</span>
                  <code className="max-w-full break-all rounded bg-muted px-2 py-1 text-xs">{feedback.link}</code>
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(feedback.link ?? "")}>Copy link</Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto border-b">
            <TabsList variant="line" className="h-12 gap-3 sm:gap-7">
              <TabsTrigger value="members" className="px-4">Users</TabsTrigger>
              <TabsTrigger value="permissions" className="px-4">Permissions</TabsTrigger>
              <TabsTrigger value="roles" className="px-4">Roles</TabsTrigger>
              <TabsTrigger value="teams" className="px-4">Teams</TabsTrigger>
              {isAdmin && <TabsTrigger value="invitations" className="px-4">Invitations</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="members" className="min-w-0 pt-4">
            <UserTable members={members} teams={teams} currentUserId={currentUserId} isAdmin={isAdmin} busy={busy} loading={loading} onEdit={openEdit} onDeactivate={(member) => { setFeedback(null); setReassignTo(""); setDeactivateReason(""); setDeactivating(member); }} />
          </TabsContent>
          <TabsContent value="permissions" className="space-y-5 bg-card p-6 sm:p-8">
            <h2>Workspace permissions</h2>
            <p className="text-sm text-muted-foreground">These are the application’s enforced rules, not editable security settings. Your role is {role}.</p>
            <Table><TableHeader><TableRow><TableHead>Capability</TableHead><TableHead>Admin</TableHead><TableHead>Manager</TableHead><TableHead>Member</TableHead></TableRow></TableHeader><TableBody>
              <TableRow><TableCell>View people and manage teams</TableCell><TableCell>Yes</TableCell><TableCell>Yes</TableCell><TableCell>No</TableCell></TableRow>
              <TableRow><TableCell>Invite users and import CSV</TableCell><TableCell>Yes</TableCell><TableCell>No</TableCell><TableCell>No</TableCell></TableRow>
              <TableRow><TableCell>Edit users, roles and access status</TableCell><TableCell>Yes</TableCell><TableCell>No</TableCell><TableCell>No</TableCell></TableRow>
              <TableRow><TableCell>Create objectives and manage cycles</TableCell><TableCell>Yes</TableCell><TableCell>Yes</TableCell><TableCell>No</TableCell></TableRow>
            </TableBody></Table>
            <p className="text-sm text-muted-foreground">Deactivated users cannot access the workspace. Admins cannot deactivate themselves or remove the last active admin. History is preserved.</p>
          </TabsContent>
          <TabsContent value="roles" className="space-y-5 bg-card p-6 sm:p-8">
            <h2>Built-in roles</h2><p className="text-sm text-muted-foreground">Roles are fixed by the application. There is no custom role editor.</p>
            <dl className="grid gap-6 md:grid-cols-3">
              <div><dt className="font-semibold">Admin</dt><dd className="mt-2 text-sm text-muted-foreground">Manages invitations, CSV imports, users and access, as well as teams, objectives and cycles.</dd></div>
              <div><dt className="font-semibold">Manager</dt><dd className="mt-2 text-sm text-muted-foreground">Views the directory and manages teams, objectives and cycles. Cannot change user access or send invitations.</dd></div>
              <div><dt className="font-semibold">Member</dt><dd className="mt-2 text-sm text-muted-foreground">Participates in the OKR workspace. Does not have access to User Management or team administration.</dd></div>
            </dl>
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
                  <Button type="submit" disabled={busy || !inviteEmail.trim()}>Create invitation</Button>
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

        </Tabs>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="shrink-0 border-b p-6"><DialogTitle>Edit User</DialogTitle><DialogDescription>Update profile and workspace access. Email is read-only.</DialogDescription></DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-2">
            {feedback?.tone === "error" && <Alert variant="destructive"><AlertDescription>{feedback.message}</AlertDescription></Alert>}
            <Field><FieldLabel htmlFor="edit-email">Email</FieldLabel><Input id="edit-email" value={editing?.email ?? ""} readOnly /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="edit-first-name">First name</FieldLabel><Input id="edit-first-name" maxLength={160} value={editFirstName} onChange={(event) => setEditFirstName(event.target.value)} readOnly={!editing?.nameEditable} disabled={busy} /></Field>
              <Field><FieldLabel htmlFor="edit-last-name">Last name</FieldLabel><Input id="edit-last-name" maxLength={160} value={editLastName} onChange={(event) => setEditLastName(event.target.value)} readOnly={!editing?.nameEditable} disabled={busy} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">{editing?.nameEditable ? "First and last names are saved together as the account display name (160 characters maximum). Existing names split at the first space." : "This account is shared across workspaces. Its name is read-only here to avoid changing another workspace’s account details."}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="edit-status">Status</FieldLabel><Select value={editActive ? "active" : "inactive"} disabled={busy || editing?.userId === currentUserId || Boolean(lastAdmin)} onValueChange={(value) => setEditActive(value === "active")}><SelectTrigger id="edit-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="edit-role">Role</FieldLabel><Select value={editRole} disabled={busy || Boolean(lastAdmin)} onValueChange={(value) => setEditRole(value as Role)}><SelectTrigger id="edit-role" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select></Field>
            </div>
            <p className="text-xs text-muted-foreground">Inactive means no workspace access, not an employment lifecycle. You cannot deactivate yourself or remove the last active admin.</p>
            <Field><FieldLabel htmlFor="edit-manager">Manager</FieldLabel><MemberSelect id="edit-manager" value={editManager} onChange={setEditManager} members={members} placeholder="No manager" noneLabel="No manager" exclude={editing?.userId} /></Field>
            <Field><FieldLabel htmlFor="edit-job-title">Job title</FieldLabel><Input id="edit-job-title" maxLength={160} value={editJobTitle} disabled={busy} onChange={(event) => setEditJobTitle(event.target.value)} /></Field>
            <fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Teams</legend>{teams.map((team) => <label key={team.id} className="flex items-center gap-3 text-sm"><Checkbox checked={editTeams.includes(team.id)} disabled={busy} onCheckedChange={(checked) => setEditTeams((current) => checked === true ? [...current, team.id] : current.filter((id) => id !== team.id))} />{team.name}</label>)}{!teams.length && <p className="text-sm text-muted-foreground">No teams available.</p>}<p className="text-xs text-muted-foreground">Removing a user from a team also clears their team lead assignment there. Inactive users cannot be added to teams.</p></fieldset>
            {!editActive && editing?.isActive && <div className="space-y-4 rounded-md border p-4"><p className="text-sm">Deactivation preserves history. You will confirm before saving.</p><Field><FieldLabel htmlFor="edit-reassign">Reassign objectives and key results</FieldLabel><MemberSelect id="edit-reassign" value={reassignTo} onChange={setReassignTo} members={members} placeholder="Keep current ownership" noneLabel="Keep current ownership" exclude={editing.userId} /></Field><Field><FieldLabel htmlFor="edit-reason">Reason (optional)</FieldLabel><Input id="edit-reason" maxLength={500} value={deactivateReason} onChange={(event) => setDeactivateReason(event.target.value)} /></Field>{editing.directReportCount > 0 && <p className="text-sm text-muted-foreground">Update the manager for their {editing.directReportCount} direct reports separately.</p>}</div>}
            <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Not available in this workspace</p><p className="mt-1">Mobile number, locale, hire and termination dates, location, department and Insights are not supported. They are not collected or saved here.</p></div>
          </div>
          <DialogFooter className="shrink-0 border-t bg-card p-6"><Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={busy || (Boolean(editing?.nameEditable) && (!editFirstName.trim() || `${editFirstName.trim()} ${editLastName.trim()}`.trim().length > 160))}>{busy ? "Saving…" : "Save changes"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={editConfirm} onOpenChange={(open) => { if (!busy) setEditConfirm(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Deactivate {editing?.name} and save changes?</AlertDialogTitle><AlertDialogDescription>This removes workspace access and preserves history. {reassignTo ? "Their objectives and key results will be reassigned." : "Their current goal ownership will be kept."}</AlertDialogDescription></AlertDialogHeader>{feedback?.tone === "error" && <p role="alert" className="text-sm text-destructive">{feedback.message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void saveEdit(true)}>Deactivate and save</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog open={Boolean(deactivating)} onOpenChange={(open) => { if (!open && !busy) setDeactivating(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {deactivating?.name}?</DialogTitle>
            <DialogDescription>
              They will lose access to the workspace. Their check-ins, comments and audit history are kept, and you can reactivate them later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {feedback?.tone === "error" && <Alert variant="destructive"><AlertDescription>{feedback.message}</AlertDescription></Alert>}
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
    </section>
  );
}
