"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Cycle, Workspace } from "@/app/types";

export type Feedback = { tone: "success" | "error"; message: string } | null;

interface WorkspaceContextType {
  workspace: Workspace | null;
  loading: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  feedback: Feedback;
  setFeedback: (feedback: Feedback) => void;
  selectedCycleId: string;
  setSelectedCycleId: (id: string | ((curr: string) => string)) => void;
  selectedCycle: Cycle | undefined;
  selectedOpenCycle: Cycle | undefined;
  teamCount: number | null;
  loadWorkspace: () => Promise<void>;
  send: (url: string, method: string, body?: unknown, successMessage?: string) => Promise<any>;
  exportCycle: () => void;
  logout: () => Promise<void>;
  canManage: boolean;
  isAdmin: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [teamCount, setTeamCount] = useState<number | null>(null);

  const loadWorkspace = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/?session=expired";
        return;
      }
      if (response.status === 403) {
        window.location.href = "/deactivated";
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", message: data.error ?? "Could not load the workspace." });
        return;
      }
      const loaded = data as Workspace;
      setWorkspace(loaded);
      setSelectedCycleId((currentSelected) => {
        if (currentSelected && loaded.cycles.some((cycle) => cycle.id === currentSelected)) {
          return currentSelected;
        }
        return loaded.cycles[0]?.id ?? "";
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const workspaceRole = workspace?.company.role;
  useEffect(() => {
    if (workspaceRole !== "admin" && workspaceRole !== "manager") return;
    let cancelled = false;
    fetch("/api/teams", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.teams)) setTeamCount(data.teams.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceRole]);

  const cycles = workspace?.cycles ?? [];
  const selectedCycle = cycles.find((cycle) => cycle.id === selectedCycleId);
  const selectedOpenCycle = selectedCycle?.status === "open" ? selectedCycle : undefined;

  async function send(url: string, method: string, body?: unknown, successMessage = "Saved.") {
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
        setFeedback({ tone: "error", message: `${response.status}: ${data.error ?? "Request failed."}` });
        if (response.status === 409) {
          await loadWorkspace();
        }
        return null;
      }
      setFeedback({ tone: "success", message: successMessage });
      await loadWorkspace();
      return data;
    } finally {
      setBusy(false);
    }
  }

  // The server builds the CSV from goals this person can see, so hidden goals never reach the file.
  function exportCycle() {
    if (!selectedCycle) return;
    const link = document.createElement("a");
    link.href = `/api/exports/goals?cycleId=${encodeURIComponent(selectedCycle.id)}`;
    link.download = "";
    link.click();
  }

  async function logout() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => null);
    window.location.href = "/";
  }

  const canManage = workspace?.company.role === "admin" || workspace?.company.role === "manager";
  const isAdmin = workspace?.company.role === "admin";

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        loading,
        busy,
        setBusy,
        feedback,
        setFeedback,
        selectedCycleId,
        setSelectedCycleId,
        selectedCycle,
        selectedOpenCycle,
        teamCount,
        loadWorkspace,
        send,
        exportCycle,
        logout,
        canManage,
        isAdmin,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
