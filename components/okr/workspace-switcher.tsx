"use client";

import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import type { Workspace } from "@/app/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";

interface WorkspaceSwitcherProps {
  workspace: Workspace;
  onWorkspaceSwitched?: () => void;
  className?: string;
}

export function WorkspaceSwitcher({ workspace, onWorkspaceSwitched, className }: WorkspaceSwitcherProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentCompany = workspace.company;
  const workspaces = workspace.workspaces && workspace.workspaces.length > 0
    ? workspace.workspaces
    : [currentCompany];

  async function switchWorkspace(companyId: string) {
    if (companyId === currentCompany.id) return;
    setBusy(true);
    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to switch workspace.");
      }
      if (onWorkspaceSwitched) {
        onWorkspaceSwitched();
      } else {
        window.location.reload();
      }
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Failed to switch workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (!newWorkspaceName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWorkspaceName.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Could not create workspace.");
      }
      setCreateDialogOpen(false);
      setNewWorkspaceName("");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group"
            title="Switch or create workspace"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-teal/15 text-brand-teal">
                <Building2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground group-hover:text-brand-teal transition-colors">
                  {currentCompany.name}
                </p>
                <p className="truncate text-[11px] capitalize text-sidebar-muted">
                  {currentCompany.role} · OKR Workspace
                </p>
              </div>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted group-hover:text-sidebar-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64 bg-sidebar text-sidebar-foreground border-sidebar-border">
          <DropdownMenuLabel className="text-xs text-sidebar-muted font-normal">
            Your Workspaces
          </DropdownMenuLabel>

          {workspaces.map((ws) => {
            const isCurrent = ws.id === currentCompany.id;
            return (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => switchWorkspace(ws.id)}
                className="flex items-center justify-between cursor-pointer focus:bg-sidebar-accent focus:text-sidebar-foreground"
              >
                <div className="min-w-0 pr-2">
                  <p className="truncate font-medium text-sm">{ws.name}</p>
                  <p className="text-xs text-sidebar-muted capitalize">{ws.role}</p>
                </div>
                {isCurrent && <Check className="size-4 text-brand-teal shrink-0" />}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator className="bg-sidebar-border" />

          <DropdownMenuItem
            onClick={() => setCreateDialogOpen(true)}
            className="cursor-pointer text-brand-teal focus:bg-brand-teal/10 focus:text-brand-teal font-medium"
          >
            <Plus className="mr-2 size-4" />
            Create New Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateWorkspace}>
            <DialogHeader>
              <DialogTitle>Create New Workspace</DialogTitle>
              <DialogDescription>
                Set up an isolated workspace for a new company or division. You will be the primary Admin.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              <Field>
                <FieldLabel htmlFor="workspace-name">Workspace / Company Name</FieldLabel>
                <Input
                  id="workspace-name"
                  required
                  minLength={2}
                  maxLength={60}
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  placeholder="e.g. Acme Corp or Growth Division"
                  className="mt-1"
                  autoFocus
                />
              </Field>

              {error && (
                <p className="text-xs text-destructive font-medium">{error}</p>
              )}
            </div>

            <DialogFooter className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !newWorkspaceName.trim()}
                className="bg-brand-teal text-white hover:bg-brand-teal/90"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create Workspace"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
