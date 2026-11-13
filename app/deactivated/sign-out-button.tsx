"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ redirectTo = "/", label = "Sign out", variant = "default" }: {
  redirectTo?: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => null);
    window.location.href = redirectTo;
  }

  return (
    <Button className="w-full" variant={variant} onClick={signOut} disabled={busy}>
      {busy ? "Signing out…" : label}
    </Button>
  );
}
