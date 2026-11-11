"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password, callbackURL: "/dashboard" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? "The reset link is invalid or expired.");
      setMessage("Password updated. You can sign in now.");
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reset link is invalid or expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md place-items-center p-6">
      <Card className="w-full"><CardHeader><CardTitle>Choose a new password</CardTitle><CardDescription>The reset link confirms your identity.</CardDescription></CardHeader>
        <CardContent><form className="grid gap-3" onSubmit={submit}>
          <Field><FieldLabel htmlFor="new-password">New password</FieldLabel><Input id="new-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Button type="submit" disabled={busy}>Update password</Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-success">{message}</p>}
        </form></CardContent>
      </Card>
    </main>
  );
}
