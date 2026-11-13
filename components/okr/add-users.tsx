"use client";

import { useState } from "react";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, ListChecks, Upload, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv, parseEmails } from "@/lib/people";
import { EMPLOYEE_CSV_HEADERS } from "@/server/csv";
import type { Role } from "@/app/types";

const CSV_TEMPLATE = `${EMPLOYEE_CSV_HEADERS.join(",")}\r\n`;

interface ImportResult {
  created: number;
  updated: number;
  invited: number;
  dryRun: boolean;
  errors: { row: number; field: string; message: string }[];
  rows?: { row: number; email: string; action: string; changes: string[] }[];
  deliveries?: { email: string; status: string; error: string | null }[];
}

interface StagedUser {
  email: string;
  role: Role;
}

interface InviteOutcome {
  email: string;
  created: boolean;
  message: string;
  link?: string;
}

export const deliveryLabels: Record<string, string> = {
  in_app_only: "Link only — email is not configured",
  pending: "Delivery not confirmed",
  sent: "Email accepted by delivery provider",
  failed: "Email delivery failed",
  unknown: "Delivery status unavailable — check Invitations",
};

export function AddUsers({ onFinish, onChanged }: { onFinish: () => void; onChanged: () => Promise<void> }) {
  const [method, setMethod] = useState("manual");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [staged, setStaged] = useState<StagedUser[]>([]);
  const [outcomes, setOutcomes] = useState<InviteOutcome[]>([]);
  const [csvText, setCsvText] = useState(CSV_TEMPLATE);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [discard, setDiscard] = useState(false);
  const complete = result?.dryRun === false;

  function collectEmails(stage: boolean, input = emailInput) {
    const parsed = parseEmails(input, [...chips, ...staged.map((person) => person.email)]);
    const next = [...chips, ...parsed.emails];
    setNotice([parsed.invalid.length ? `Invalid emails: ${parsed.invalid.join(", ")}. Correct or remove them before continuing.` : "", parsed.duplicates ? `${parsed.duplicates} duplicate addresses ignored.` : ""].filter(Boolean).join(" "));
    setEmailInput(parsed.invalid.join(", "));
    if (stage && !parsed.invalid.length) {
      setStaged((current) => [...current, ...next.map((email) => ({ email, role: "member" as Role }))]);
      setChips([]);
    } else setChips(next);
  }

  async function addStaged() {
    setBusy(true);
    setNotice("");
    const batch: InviteOutcome[] = [];
    for (const person of staged) {
      try {
        const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(person) });
        if (response.status === 401) { window.location.href = "/?session=expired"; break; }
        const data = await response.json();
        const created = response.ok && Boolean(data.invitation?.id);
        batch.push({ email: person.email, created, message: created ? `Invitation created. ${deliveryLabels[data.invitation.emailDeliveryStatus] ?? deliveryLabels.unknown}${data.invitation.emailError ? `: ${data.invitation.emailError}` : "."}` : data.error ?? "Could not confirm creation. Check Invitations before retrying.", link: data.inviteUrl });
      } catch {
        batch.push({ email: person.email, created: false, message: "Connection interrupted. Creation is unconfirmed; check Invitations before retrying." });
      }
      setOutcomes((current) => [...current.filter((outcome) => outcome.email !== person.email), batch[batch.length - 1]]);
    }
    setStaged((current) => current.filter((person) => !batch.some((outcome) => outcome.email === person.email && outcome.created)));
    setBusy(false);
    await onChanged();
  }

  async function runImport(dryRun: boolean) {
    setBusy(true);
    setNotice("");
    setConfirmImport(false);
    try {
      const response = await fetch("/api/imports/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: csvText, dryRun }) });
      if (response.status === 401) { window.location.href = "/?session=expired"; return; }
      const data = await response.json();
      if (!response.ok) {
        setResult(null);
        setNotice(`${data.error ?? "Import failed."}${data.errors?.map((error: { row: number; message: string }) => ` Row ${error.row}: ${error.message}`).join("") ?? ""}`);
        return;
      }
      setResult(data);
      if (!dryRun) await onChanged();
    } catch {
      setResult(null);
      setNotice(dryRun ? "Could not preview the CSV. Please try again." : "Import outcome is unconfirmed. Check Users and Invitations before importing again; some changes may already be saved.");
    } finally { setBusy(false); }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setResult(null);
    setNotice("");
    if (file.size > 1_000_000) { setNotice("CSV is too large (1 MB maximum)."); return; }
    try { setCsvText(await file.text()); } catch { setNotice("The file could not be read. Try again or paste the CSV below."); }
  }

  function finish() {
    if (staged.length || chips.length || emailInput.trim() || (!complete && csvText !== CSV_TEMPLATE)) setDiscard(true);
    else onFinish();
  }

  return (
    <section className="space-y-6" aria-labelledby="add-users-title">
      <Button variant="ghost" className="-ml-3" disabled={busy} onClick={finish}><ArrowLeft />User Management</Button>
      <h1 id="add-users-title" className="text-3xl lg:text-4xl">Add users manually or import from CSV</h1>
      <p className="max-w-3xl text-muted-foreground">Invite new colleagues or update existing users with a CSV. New users join the workspace only after accepting their invitation.</p>
      <RadioGroup aria-label="How to add users" className="flex flex-wrap gap-6" value={method} disabled={busy} onValueChange={(value) => { setMethod(value); setNotice(""); }}>
        <div className="flex items-center gap-2"><RadioGroupItem id="add-manual" value="manual" /><label htmlFor="add-manual">Add manually</label></div>
        <div className="flex items-center gap-2"><RadioGroupItem id="add-csv" value="csv" /><label htmlFor="add-csv">Import from CSV</label></div>
      </RadioGroup>
      {notice && <Alert variant="destructive"><AlertTitle>Needs attention</AlertTitle><AlertDescription className="break-words">{notice}</AlertDescription></Alert>}
      {method === "manual" ? (
        <div className="space-y-6 bg-card p-5 sm:p-8">
          <Field><FieldLabel htmlFor="email-chips">Email addresses</FieldLabel>
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              {chips.map((email) => <Badge variant="secondary" key={email} className="max-w-full gap-2 py-1"><span className="break-all">{email}</span><button type="button" className="rounded focus-visible:outline-2" aria-label={`Remove ${email}`} disabled={busy} onClick={() => setChips(chips.filter((chip) => chip !== email))}><X className="size-3" /></button></Badge>)}
              <Input id="email-chips" className="min-w-44 flex-1 border-0 shadow-none" placeholder="name@company.com" value={emailInput} disabled={busy} onChange={(event) => setEmailInput(event.target.value)} onPaste={(event) => { const text = event.clipboardData.getData("text"); if (/[\s,;]/.test(text.trim())) { event.preventDefault(); collectEmails(false, `${emailInput} ${text}`); } }} onKeyDown={(event) => { if (["Enter", ",", ";"].includes(event.key)) { event.preventDefault(); collectEmails(false); } }} />
            </div>
            <FieldDescription>Separate addresses with commas, spaces or Enter. Duplicates are removed. Nothing is saved until you choose Add users.</FieldDescription>
          </Field>
          <Button variant="outline" disabled={busy || (!chips.length && !emailInput.trim())} onClick={() => collectEmails(true)}>Add to staged list</Button>
          {staged.length > 0 && <Table><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead><span className="sr-only">Remove</span></TableHead></TableRow></TableHeader><TableBody>
            {staged.map((person) => <TableRow key={person.email}><TableCell className="py-5">{person.email}</TableCell><TableCell>
              <Select value={person.role} disabled={busy} onValueChange={(value) => setStaged((current) => current.map((entry) => entry.email === person.email ? { ...entry, role: value as Role } : entry))}><SelectTrigger aria-label={`Role for ${person.email}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select>
            </TableCell><TableCell className="text-right"><Button size="icon" variant="ghost" aria-label={`Remove staged ${person.email}`} disabled={busy} onClick={() => setStaged(staged.filter((entry) => entry.email !== person.email))}><X /></Button></TableCell></TableRow>)}
          </TableBody></Table>}
          {outcomes.length > 0 && <div className="space-y-3" role="status"><h2>Invitation results</h2><p className="text-sm text-muted-foreground">{outcomes.filter((outcome) => outcome.created).length} invitations created; {outcomes.filter((outcome) => !outcome.created).length} failed or unconfirmed. Unsuccessful entries stay in the staged list.</p>{outcomes.map((outcome) => <div key={outcome.email} className="rounded-md border p-4"><p className="break-all font-medium">{outcome.email}</p><p className="mt-1 text-sm">{outcome.message}</p>{outcome.link && <div className="mt-2 space-y-2"><p className="text-sm text-muted-foreground">Share this private invitation link directly:</p><Input readOnly aria-label={`Invitation link for ${outcome.email}`} value={outcome.link} onFocus={(event) => event.target.select()} /></div>}</div>)}</div>}
          <div className="flex flex-wrap justify-end gap-3 border-t pt-5"><Button variant="outline" disabled={busy} onClick={finish}>{outcomes.length ? "Finish" : "Cancel"}</Button><Button disabled={busy || !staged.length || Boolean(chips.length || emailInput.trim())} onClick={() => void addStaged()}>{busy ? "Creating invitations…" : `Add ${staged.length} users`}</Button></div>
        </div>
      ) : (
        <div className="space-y-6">
          {!complete && <>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { icon: FileSpreadsheet, title: "1. Prepare your file", text: "Use the template headers exactly. Include an email on every row; use admin, manager or member for role. Limit: 2,000 rows / 1 MB." },
                { icon: Upload, title: "2. Upload and preview", text: "Existing users are updated; new emails create invitations. Teams may be created. Name is used for invitations only, not existing account names." },
                { icon: ListChecks, title: "3. Review and confirm", text: "Review every change and row error. Invalid rows are skipped. Inactive removes workspace access but keeps history; blank status defaults to active." },
              ].map(({ icon: Icon, title, text }) => <Card key={title} className="rounded-sm shadow-none"><CardHeader><Icon className="mb-3 size-6 text-primary" /><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="text-sm leading-relaxed text-muted-foreground">{text}</CardContent></Card>)}
            </div>
            <div className="space-y-5 bg-card p-5 sm:p-8">
              <Button variant="outline" onClick={() => downloadCsv("employee-import-template.csv", CSV_TEMPLATE)}><Download />Download CSV template</Button>
              <Field><FieldLabel htmlFor="csv-file">Upload a CSV file</FieldLabel><Input id="csv-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void readFile(event.target.files?.[0])} /><FieldDescription>Headers: {EMPLOYEE_CSV_HEADERS.join(", ")}. Blank role, manager, team and job title keep existing values. CSV does not reassign goals; use Deactivate from Users when reassignment is needed.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="csv-text">Or paste CSV</FieldLabel><Textarea id="csv-text" rows={8} className="font-mono text-xs" value={csvText} disabled={busy} onChange={(event) => { setCsvText(event.target.value); setResult(null); }} /></Field>
              <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void runImport(true)} disabled={busy || !csvText.trim()}>{busy ? "Working…" : "Preview changes"}</Button><Button onClick={() => setConfirmImport(true)} disabled={busy || !result?.dryRun || !result.rows?.some((row) => ["update", "invite"].includes(row.action))}>Review and import</Button></div>
            </div>
          </>}
          {result && <div className="space-y-5 bg-card p-5 sm:p-8" role="status">
            <div className="flex items-center gap-3">{complete && <CheckCircle2 className="size-7 text-primary" />}<h2>{complete ? "Import finished" : "Preview — nothing saved yet"}</h2></div>
            <p>{result.updated} {complete ? "users updated" : "users to update"} · {result.invited} {complete ? "invitations created" : "invitations to create"} · {result.created} {complete ? "teams created" : "teams to create"} · {new Set(result.errors.map((error) => error.row)).size} rows {complete ? "skipped" : "with errors"}</p>
            {complete && <p className="text-sm text-muted-foreground">Changes have been saved. New users must accept their invitations. No background import is running; delivery outcomes are listed below and in Invitations.</p>}
            {result.errors.length > 0 && <Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Field</TableHead><TableHead>Error</TableHead></TableRow></TableHeader><TableBody>{result.errors.map((error, index) => <TableRow key={index}><TableCell>{error.row}</TableCell><TableCell>{error.field}</TableCell><TableCell className="whitespace-normal">{error.message}</TableCell></TableRow>)}</TableBody></Table>}
            {result.rows && <Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Email</TableHead><TableHead>Action</TableHead><TableHead>Changes</TableHead></TableRow></TableHeader><TableBody>{result.rows.map((row) => <TableRow key={row.row}><TableCell>{row.row}</TableCell><TableCell>{row.email}</TableCell><TableCell>{row.action}</TableCell><TableCell className="whitespace-normal">{row.changes.join(", ") || "—"}</TableCell></TableRow>)}</TableBody></Table>}
            {result.deliveries?.map((delivery) => <p key={delivery.email} className="break-words text-sm">{delivery.email}: {deliveryLabels[delivery.status] ?? deliveryLabels.unknown}{delivery.error && ` — ${delivery.error}`}</p>)}
            {complete && <div className="flex justify-end"><Button onClick={finish}>Finish</Button></div>}
          </div>}
        </div>
      )}
      <AlertDialog open={confirmImport} onOpenChange={setConfirmImport}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Apply these CSV changes?</AlertDialogTitle><AlertDialogDescription>{result?.updated ?? 0} users will be updated, {result?.invited ?? 0} invitations created and {result?.created ?? 0} teams created. Invalid rows will be skipped. Any inactive status removes access and preserves history, without reassigning goals. Data is validated again when you confirm.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Go back</AlertDialogCancel><Button onClick={() => void runImport(false)} disabled={busy}>Confirm import</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave Add users?</AlertDialogTitle><AlertDialogDescription>Unsubmitted addresses and CSV drafts will be discarded. Invitations and changes already saved are kept.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep working</AlertDialogCancel><Button onClick={onFinish}>Leave</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  );
}
