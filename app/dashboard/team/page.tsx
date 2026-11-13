"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PeopleSection } from "@/components/okr/people-section";
import { useWorkspace } from "@/components/okr/workspace-context";

export default function TeamPage() {
  const { workspace, canManage } = useWorkspace();

  if (!workspace) return null;

  if (!canManage) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl lg:text-4xl">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your workspace’s people and access.</p>
        </header>
        <Alert variant="destructive">
          <AlertTitle>Access restricted</AlertTitle>
          <AlertDescription>
            Only workspace managers and admins can view the team directory and manage permissions.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PeopleSection role={workspace.company.role} currentUserId={workspace.user.id} />
    </div>
  );
}
