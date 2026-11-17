export interface DirectoryMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "member";
  isActive: boolean;
  teams: { id: string; name: string; isLead: boolean }[];
}

export function splitName(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export function parseEmails(input: string, existing: string[] = []) {
  const seen = new Set(existing.map((email) => email.toLowerCase()));
  const emails: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const email of input.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean)) {
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.push(email);
    else if (seen.has(email)) duplicates += 1;
    else {
      seen.add(email);
      emails.push(email);
    }
  }
  return { emails, invalid, duplicates };
}

export type UserSort = "email" | "firstName" | "lastName" | "role" | "status";

export function filterUsers<Member extends DirectoryMember>(members: Member[], filters: { search: string; role: string; status: string; team: string }, sort: UserSort, descending: boolean) {
  const search = filters.search.trim().toLowerCase();
  const value = (member: Member) => sort === "status" ? (member.isActive ? "active" : "inactive")
    : sort === "firstName" || sort === "lastName" ? splitName(member.name)[sort] : member[sort];
  return members.filter((member) =>
    (!search || `${member.name} ${member.email} ${member.userId}`.toLowerCase().includes(search)) &&
    (filters.role === "all" || member.role === filters.role) &&
    (filters.status === "all" || member.isActive === (filters.status === "active")) &&
    (filters.team === "all" || (filters.team === "none" ? !member.teams.length : member.teams.some((team) => team.id === filters.team)))
  ).sort((left, right) => (value(left).localeCompare(value(right), undefined, { numeric: true, sensitivity: "base" }) || left.id.localeCompare(right.id)) * (descending ? -1 : 1));
}

export function safeCsvCell(value: string) {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function usersCsv(members: DirectoryMember[]) {
  return [
    ["Email", "ID", "First Name", "Last Name", "Role", "Status", "Teams"],
    ...members.map((member) => [member.email, member.userId, splitName(member.name).firstName, splitName(member.name).lastName, member.role, member.isActive ? "active" : "inactive", member.teams.map((team) => team.name).join("; ")]),
  ].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
