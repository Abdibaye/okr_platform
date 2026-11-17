"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, filterUsers, splitName, usersCsv, type DirectoryMember, type UserSort } from "@/lib/people";

export function UserTable<Member extends DirectoryMember>({ members, teams, currentUserId, isAdmin, busy, loading, onEdit, onDeactivate }: {
  members: Member[];
  teams: { id: string; name: string }[];
  currentUserId: string;
  isAdmin: boolean;
  busy: boolean;
  loading: boolean;
  onEdit: (member: Member) => void;
  onDeactivate: (member: Member) => void;
}) {
  const [filters, setFilters] = useState({ search: "", role: "all", status: "all", team: "all" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<UserSort>("email");
  const [descending, setDescending] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const filtered = filterUsers(members, filters, sort, descending);
  const selected = filtered.filter((member) => selection.includes(member.id));
  const filterCount = [filters.role, filters.status, filters.team].filter((value) => value !== "all").length;
  const activeAdmins = members.filter((member) => member.role === "admin" && member.isActive).length;

  function changeFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelection([]);
  }

  return (
    <div className="min-w-0 bg-card text-card-foreground">
      <div className="flex flex-wrap items-center gap-3 p-5 sm:p-6">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search users by name, email or ID" placeholder="Search users" className="pl-9" value={filters.search} onChange={(event) => changeFilter("search", event.target.value)} />
        </div>
        <Button variant="outline" aria-expanded={filtersOpen} aria-controls="user-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal />Filters{filterCount > 0 && ` (${filterCount})`}</Button>
        <Button variant="outline" disabled={!filtered.length} onClick={() => downloadCsv(selected.length ? "selected-users.csv" : "filtered-users.csv", usersCsv(selected.length ? selected : filtered))}><Download />Export {selected.length ? `selected (${selected.length})` : `filtered (${filtered.length})`}</Button>
      </div>
      {filtersOpen && (
        <div id="user-filters" className="grid gap-4 border-y bg-background p-5 sm:grid-cols-3 sm:p-6">
          {([
            ["role", "Role", [["all", "All roles"], ["admin", "Admin"], ["manager", "Manager"], ["member", "Member"]]],
            ["status", "Status", [["all", "All statuses"], ["active", "Active"], ["inactive", "Inactive"]]],
            ["team", "Team", [["all", "All teams"], ["none", "No team"], ...teams.map((team) => [team.id, team.name])]],
          ] as const).map(([key, label, options]) => (
            <Field key={key}><FieldLabel htmlFor={`filter-${key}`}>{label}</FieldLabel>
              <Select value={filters[key]} onValueChange={(value) => changeFilter(key, value)}>
                <SelectTrigger id={`filter-${key}`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pb-3 pt-3 text-sm text-muted-foreground" role="status">
        <span>{loading ? "Loading users…" : `${filtered.length} users · ${selected.length} selected`}</span>
        {selection.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSelection([])}>Clear selection</Button>}
        <span className="text-xs">Export includes {selected.length ? "selected users only" : "all filtered users"}. Changing filters clears selection.</span>
      </div>
      <Table>
        <TableHeader><TableRow>
          <TableHead className="w-14 pl-6"><Checkbox aria-label="Select all filtered users" disabled={!filtered.length} checked={selected.length > 0 && selected.length === filtered.length ? true : selected.length ? "indeterminate" : false} onCheckedChange={(checked) => setSelection(checked === true ? filtered.map((member) => member.id) : [])} /></TableHead>
          {([["email", "Email/ID"], ["firstName", "First Name"], ["lastName", "Last Name"], ["role", "Role"], ["status", "Status"]] as const).map(([key, label]) => (
            <TableHead key={key} aria-sort={sort === key ? descending ? "descending" : "ascending" : "none"}>
              <Button variant="ghost" className="-ml-3 justify-between gap-6" onClick={() => { setSort(key); setDescending(sort === key ? !descending : false); }}>{label}{sort === key ? descending ? <ArrowDown /> : <ArrowUp /> : <ArrowUpDown className="text-muted-foreground" />}</Button>
            </TableHead>
          ))}
          {isAdmin && <TableHead className="text-right pr-6"><span className="sr-only">Actions</span></TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {filtered.map((member) => (
            <TableRow key={member.id} data-state={selection.includes(member.id) ? "selected" : undefined}>
              <TableCell className="pl-6"><Checkbox aria-label={`Select ${member.email}`} checked={selection.includes(member.id)} onCheckedChange={(checked) => setSelection((current) => checked === true ? [...current, member.id] : current.filter((id) => id !== member.id))} /></TableCell>
              <TableCell className="py-7"><p className="font-medium">{member.email}{member.userId === currentUserId && " (you)"}</p><p className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={member.userId}>{member.userId}</p></TableCell>
              <TableCell>{splitName(member.name).firstName || "—"}</TableCell>
              <TableCell>{splitName(member.name).lastName || "—"}</TableCell>
              <TableCell className="capitalize">{member.role}</TableCell>
              <TableCell><Badge variant={member.isActive ? "secondary" : "outline"}>{member.isActive ? "Active" : "Inactive"}</Badge></TableCell>
              {isAdmin && <TableCell className="pr-6 text-right"><div className="flex justify-end gap-1">
                <Button variant="link" size="sm" disabled={busy} onClick={() => onEdit(member)} aria-label={`Edit ${member.email}`}>Edit</Button>
                {member.isActive && <Button variant="ghost" size="sm" disabled={busy || member.userId === currentUserId || (member.role === "admin" && activeAdmins <= 1)} onClick={() => onDeactivate(member)} aria-label={`Deactivate ${member.email}`}>Deactivate</Button>}
              </div></TableCell>}
            </TableRow>
          ))}
          {!filtered.length && <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="h-40 text-center text-muted-foreground">{loading ? "Loading users…" : members.length ? "No users match your search or filters." : "No users available. Check any loading error above."}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
