"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/components/okr/workspace-context";

export default function ActivityPage() {
  const { workspace } = useWorkspace();

  if (!workspace) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl lg:text-4xl">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">Workspace audit trail of cycle closes, reopens, and team access events.</p>
        </div>
      </header>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Workspace activity log</CardTitle>
          <CardDescription>All governance, status transitions, and audited administrative actions are recorded here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspace.audit.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell><Badge variant="secondary">{entry.action}</Badge></TableCell>
                  <TableCell>{entry.reason}</TableCell>
                  <TableCell className="tabular-nums">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {!workspace.audit.length && (
                <TableRow>
                  <TableCell className="text-muted-foreground">No audit entries yet.</TableCell>
                  <TableCell /><TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
