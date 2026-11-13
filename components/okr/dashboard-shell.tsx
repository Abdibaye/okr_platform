"use client";

import React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AppShell } from "./app-shell";
import { useWorkspace, WorkspaceProvider } from "./workspace-context";

function DashboardShellContent({ children }: { children: React.ReactNode }) {
  const { workspace, feedback, logout, loading } = useWorkspace();

  if (!workspace) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 bg-background">
        {feedback?.tone === "error" ? (
          <Alert variant="destructive" className="max-w-md">
            <AlertTitle>Unable to load workspace</AlertTitle>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground">{loading ? "Loading your workspace…" : "No workspace data found."}</p>
        )}
      </div>
    );
  }

  return (
    <AppShell workspace={workspace} unreadCount={workspace.audit.length} onSignOut={logout}>
      {feedback && (
        <Alert variant={feedback.tone === "error" ? "destructive" : "default"} className="mb-6">
          <AlertTitle>{feedback.tone === "error" ? "Action blocked" : "Done"}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}
      {children}
    </AppShell>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardShellContent>{children}</DashboardShellContent>
    </WorkspaceProvider>
  );
}
