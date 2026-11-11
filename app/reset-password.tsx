"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ResetPasswordScreen({
  token,
  tokenError,
}: {
  token: string | null;
  tokenError: string | null;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linkInvalid = Boolean(tokenError) || !token;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) {
      setError("The reset link is missing or invalid.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? "The reset link is invalid or expired.");
      window.location.href = "/?reset=success";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reset link is invalid or expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md place-items-center p-6">
      <div className="w-full space-y-4">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>
              {linkInvalid
                ? "This password reset link is invalid or expired."
                : "Enter a new password of at least 8 characters. Active sessions will be signed out."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {linkInvalid ? (
              <Alert variant="destructive">
                <AlertTitle>Invalid or expired reset link</AlertTitle>
                <AlertDescription>
                  Request a new password reset link from the sign-in screen.
                </AlertDescription>
              </Alert>
            ) : (
              <form className="grid gap-3" onSubmit={submit}>
                <Field>
                  <FieldLabel htmlFor="new-password">New password</FieldLabel>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={busy}>Update password</Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </form>
            )}
            <a className="inline-block text-sm text-primary underline" href="/">Back to sign in</a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
