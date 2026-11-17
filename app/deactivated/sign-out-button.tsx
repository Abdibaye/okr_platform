"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function SignOutButton({ redirectTo = "/", label = "Sign out", variant = "default" }: {
  redirectTo?: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        setFeedback("Signing out failed - please try again");
        return;
      }
      window.location.href = redirectTo;
    } catch {
      setFeedback("Signing out failed - please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" variant={variant} onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : label}
      </Button>
      {feedback && (
        <Alert variant="destructive">
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
