"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignOutButton } from "../deactivated/sign-out-button";

export interface InviteDetails {
  email: string;
  name: string;
  role: "admin" | "manager" | "member";
  status: "pending" | "accepted" | "revoked" | "expired";
  companyName: string;
  inviterName: string;
  expiresAt: string;
}

export function InviteScreen({ token, details, signedInEmail }: {
  token: string;
  details: InviteDetails | null;
  signedInEmail: string | null;
}) {
  const [name, setName] = useState(details?.name ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Could not accept the invitation.");
    window.location.href = "/dashboard";
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function authenticate(mode: "signup" | "login", event: React.FormEvent) {
    event.preventDefault();
    if (!details) return;
    await run(async () => {
      const endpoint = mode === "login" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email";
      const body = mode === "login" ? { email: details.email, password } : { name, email: details.email, password };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not sign you in.");
      await accept();
    });
  }

  const emailMatches = Boolean(details && signedInEmail && signedInEmail.toLowerCase() === details.email);

  return (
    <main className="grid min-h-dvh place-items-center bg-auth-canvas px-4 py-8">
      <Card className="w-full max-w-md gap-6 rounded-xl border-border shadow-none">
        {!details ? (
          <CardHeader>
            <CardTitle className="text-2xl">Invitation not found</CardTitle>
            <CardDescription>This invitation link is invalid or has been replaced by a newer one. Ask your admin to resend it.</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">Join {details.companyName}</CardTitle>
              <CardDescription>
                {details.inviterName} invited <span className="font-medium text-foreground">{details.email}</span> to the OKR workspace.
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="secondary">Role: {details.role}</Badge>
                {details.status === "pending" && (
                  <Badge variant="outline">Expires {new Date(details.expiresAt).toLocaleDateString()}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Could not continue</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {details.status === "accepted" && (
                <>
                  <p className="text-sm text-muted-foreground">This invitation has already been accepted.</p>
                  <Button className="w-full" onClick={() => { window.location.href = signedInEmail ? "/dashboard" : "/"; }}>
                    {signedInEmail ? "Go to dashboard" : "Sign in"}
                  </Button>
                </>
              )}
              {details.status === "revoked" && (
                <p className="text-sm text-muted-foreground">This invitation was revoked. Ask your admin for a new one.</p>
              )}
              {details.status === "expired" && (
                <p className="text-sm text-muted-foreground">This invitation has expired. Ask your admin to resend it.</p>
              )}

              {details.status === "pending" && signedInEmail && emailMatches && (
                <Button className="w-full" disabled={busy} onClick={() => run(accept)}>
                  {busy ? "Joining…" : `Accept and join ${details.companyName}`}
                </Button>
              )}

              {details.status === "pending" && signedInEmail && !emailMatches && (
                <>
                  <p className="text-sm text-muted-foreground">
                    You are signed in as {signedInEmail}. Sign out, then sign in or create an account with {details.email} to accept.
                  </p>
                  <SignOutButton redirectTo={`/invite?token=${encodeURIComponent(token)}`} label="Sign out and switch account" variant="outline" />
                </>
              )}

              {details.status === "pending" && !signedInEmail && (
                <Tabs defaultValue="signup" onValueChange={() => setError(null)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signup">Create account</TabsTrigger>
                    <TabsTrigger value="login">I have an account</TabsTrigger>
                  </TabsList>
                  <TabsContent value="signup">
                    <form className="space-y-4 pt-2" onSubmit={(event) => authenticate("signup", event)}>
                      <Field>
                        <FieldLabel htmlFor="invite-name">Full name</FieldLabel>
                        <Input id="invite-name" required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="invite-email">Work email</FieldLabel>
                        <Input id="invite-email" type="email" value={details.email} readOnly />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="invite-password">Password</FieldLabel>
                        <Input id="invite-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                      </Field>
                      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating account…" : "Create account and join"}</Button>
                    </form>
                  </TabsContent>
                  <TabsContent value="login">
                    <form className="space-y-4 pt-2" onSubmit={(event) => authenticate("login", event)}>
                      <Field>
                        <FieldLabel htmlFor="invite-login-email">Email</FieldLabel>
                        <Input id="invite-login-email" type="email" value={details.email} readOnly />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="invite-login-password">Password</FieldLabel>
                        <Input id="invite-login-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                      </Field>
                      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in and join"}</Button>
                    </form>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
