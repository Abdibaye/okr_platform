"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "login" | "signup";

export function AuthScreen({ initialNotice = null }: { initialNotice?: string | null }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(initialNotice);
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setResetLink(null);
    try {
      const endpoint = mode === "login" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Authentication failed.");
      window.location.href = "/dashboard";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestRecovery() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setResetLink(null);
    try {
      const response = await fetch("/api/recovery-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not request a reset link.");
      setMessage(data.message);
      setResetLink(data.resetLink ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not request a reset link.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: string) {
    setMode(nextMode as Mode);
    setError(null);
    setResetLink(null);
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center p-6">
      <div className="w-full space-y-4">
        <div className="text-center"><h1>OKR platform</h1><p className="text-muted-foreground">Sign in with a demo account or create a member account.</p></div>
        <Card>
          <CardHeader><CardTitle>Welcome</CardTitle><CardDescription>Demo admin: admin@demo.test / Demo1234! · Demo member: member@demo.test / Demo1234!</CardDescription></CardHeader>
          <CardContent>
            <Tabs value={mode} onValueChange={switchMode}>
              <TabsList className="w-full"><TabsTrigger value="login" className="flex-1">Sign in</TabsTrigger><TabsTrigger value="signup" className="flex-1">Sign up</TabsTrigger></TabsList>
              <TabsContent value="login">
                <form className="mt-4 grid gap-3" onSubmit={submit}>
                  <Field><FieldLabel htmlFor="email">Email</FieldLabel><Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                  <Field><FieldLabel htmlFor="password">Password</FieldLabel><Input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                  <Button type="submit" disabled={busy}>Sign in</Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form className="mt-4 grid gap-3" onSubmit={submit}>
                  <Field><FieldLabel htmlFor="name">Name</FieldLabel><Input id="name" required value={name} onChange={(event) => setName(event.target.value)} /></Field>
                  <Field><FieldLabel htmlFor="signup-email">Email</FieldLabel><Input id="signup-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                  <Field><FieldLabel htmlFor="signup-password">Password</FieldLabel><Input id="signup-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                  <Button type="submit" disabled={busy}>Create account</Button>
                </form>
              </TabsContent>
            </Tabs>
            <Button variant="link" className="mt-2 px-0" disabled={busy || !email} onClick={requestRecovery}>Email me a reset link</Button>
          </CardContent>
        </Card>
        {(error || message) && (
          <Alert variant={error ? "destructive" : "default"}>
            <AlertTitle>{error ? "Please try again" : resetLink ? "Recovery link ready" : "Notice"}</AlertTitle>
            <AlertDescription>{error ?? message}</AlertDescription>
            {resetLink && <a className="text-primary underline" href={resetLink}>Open password reset link</a>}
          </Alert>
        )}
      </div>
    </main>
  );
}
