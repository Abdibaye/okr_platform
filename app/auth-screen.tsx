"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  Clock,
  GitBranch,
  Lock,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "login" | "signup";

export function AuthScreen({ initialNotice = null }: { initialNotice?: string | null }) {
  const [authOpen, setAuthOpen] = useState(Boolean(initialNotice));
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
    try {
      const endpoint = mode === "login" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not sign you in.");
      window.location.href = "/dashboard";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  }

  async function quickLogin(demoEmail: string) {
    setEmail(demoEmail);
    setPassword("Demo1234!");
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: demoEmail, password: "Demo1234!" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not sign you in.");
      window.location.href = "/dashboard";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign you in.");
      setAuthOpen(true);
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
      const response = await fetch("/api/recovery-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not create a reset link.");
      setResetLink(data.link);
      setMessage(data.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a reset link.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: string) {
    if (nextMode === "login" || nextMode === "signup") {
      setMode(nextMode);
      setError(null);
      setMessage(null);
      setResetLink(null);
    }
  }

  const recoveryReady = Boolean(resetLink);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-brand-teal/20 selection:text-brand-teal-ink">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-teal to-brand-indigo text-white shadow-sm">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-lg tracking-tight">Betterworks OKR</span>
                <span className="rounded-full bg-brand-teal-soft px-2 py-0.5 text-[10px] font-medium text-brand-teal-ink border border-brand-teal/20">
                  Enterprise
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground hidden sm:block">Strategy Execution & Alignment Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMode("login");
                setAuthOpen(true);
              }}
            >
              Sign in
            </Button>
            <Button
              size="sm"
              className="bg-brand-teal text-white hover:bg-brand-teal/90 shadow-sm"
              onClick={() => quickLogin("admin@demo.test")}
              disabled={busy}
            >
              Explore Demo
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative flex-1 overflow-hidden py-10 md:py-16 flex items-center">
        {/* Soft Background Radial Glow */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-brand-teal/15 via-brand-indigo/10 to-transparent blur-3xl" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            {/* Hero Left Column: Copy & Value Proposition */}
            <div className="lg:col-span-5 space-y-6 text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5 text-brand-teal" />
                <span>Modern Enterprise Goal Architecture</span>
              </div>

              <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-5xl text-foreground leading-[1.12]">
                Align your entire company on{" "}
                <span className="bg-gradient-to-r from-brand-teal to-brand-indigo bg-clip-text text-transparent">
                  what truly matters
                </span>
                .
              </h1>

              <p className="text-base text-muted-foreground sm:text-lg font-normal leading-relaxed">
                Connect strategic vision with everyday execution. Featuring loop-free goal hierarchies,
                deterministic 0–100% progress math, and an immutable append-only check-in ledger.
              </p>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Button
                  size="lg"
                  className="bg-brand-teal hover:bg-brand-teal/90 text-white font-medium px-6 shadow-sm"
                  onClick={() => {
                    setMode("login");
                    setAuthOpen(true);
                  }}
                >
                  Sign in to Workspace
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground px-1">One-click:</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 text-xs font-semibold"
                    onClick={() => quickLogin("admin@demo.test")}
                    disabled={busy}
                  >
                    ⚡ Demo Admin
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 text-xs font-semibold"
                    onClick={() => quickLogin("member@demo.test")}
                    disabled={busy}
                  >
                    👤 Demo Member
                  </Button>
                </div>
              </div>

              {/* Trust Indicators */}
              <div className="pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Multi-Tenant RBAC</span>
                </div>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-brand-teal shrink-0" />
                  <span>Loop-Free Trees</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-indigo-600 shrink-0" />
                  <span>Immutable Ledger</span>
                </div>
              </div>
            </div>

            {/* Hero Right Column: okrhome.png Image Showcase */}
            <div className="lg:col-span-7">
              <div className="relative rounded-2xl border border-border/80 bg-card shadow-2xl overflow-hidden ring-1 ring-border/50 transition-all hover:shadow-3xl">
                {/* Browser Window Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/40 backdrop-blur-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-400/80" />
                    <div className="h-3 w-3 rounded-full bg-amber-400/80" />
                    <div className="h-3 w-3 rounded-full bg-emerald-400/80" />
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-background/80 px-3 py-1 text-[11px] font-mono text-muted-foreground border border-border/60">
                    <Lock className="h-3 w-3 text-emerald-600" />
                    <span>app.betterworks-okr.internal/dashboard</span>
                  </div>
                  <div className="w-10" />
                </div>

                {/* Dashboard Image */}
                <div className="relative bg-muted/20">
                  <Image
                    src="/okrhome.png"
                    alt="Betterworks OKR Workspace Dashboard"
                    width={3016}
                    height={1720}
                    priority
                    className="w-full h-auto object-contain block"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-border/80 py-5 text-xs text-muted-foreground bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-brand-teal text-white">
              <Target className="h-3 w-3" />
            </div>
            <span className="font-semibold text-foreground">Betterworks OKR Platform</span>
            <span>· Enterprise Ready</span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <span>Demo: <code className="bg-muted px-1 py-0.5 rounded text-[11px]">admin@demo.test / Demo1234!</code></span>
          </div>
        </div>
      </footer>

      {/* Authentication Modal Dialog */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight">
              {mode === "login" ? "Sign in to OKR Workspace" : "Create your workspace account"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {mode === "login"
                ? "Enter your credentials or use a one-click demo profile."
                : "Register a new profile for your organization."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            <Tabs defaultValue="login" value={mode} onValueChange={switchMode}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="login">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form className="grid gap-3" onSubmit={submit}>
                  <Field>
                    <FieldLabel htmlFor="email" className="text-xs">Email Address</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="name@company.com"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field>
                    <div className="flex items-center justify-between">
                      <FieldLabel htmlFor="password" className="text-xs">Password</FieldLabel>
                      <button
                        type="button"
                        onClick={requestRecovery}
                        disabled={busy || !email}
                        className="text-[11px] text-brand-teal hover:underline disabled:opacity-50"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="mt-1 w-full bg-brand-teal text-white hover:bg-brand-teal/90 h-9 font-medium"
                  >
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form className="grid gap-3" onSubmit={submit}>
                  <Field>
                    <FieldLabel htmlFor="name" className="text-xs">Full Name</FieldLabel>
                    <Input
                      id="name"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      placeholder="Jane Doe"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="signup-email" className="text-xs">Work Email</FieldLabel>
                    <Input
                      id="signup-email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="jane@company.com"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="signup-password" className="text-xs">Password (min 8 chars)</FieldLabel>
                    <Input
                      id="signup-password"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="mt-1 w-full bg-brand-teal text-white hover:bg-brand-teal/90 h-9 font-medium"
                  >
                    {busy ? "Creating account…" : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {(error || message) && (
              <div className="mt-3">
                <Alert variant={error ? "destructive" : "default"}>
                  <AlertTitle className="text-xs font-semibold">
                    {error ? "Please try again" : recoveryReady ? "Recovery link ready" : "Notice"}
                  </AlertTitle>
                  <AlertDescription className="text-xs">{error ?? message}</AlertDescription>
                  {resetLink && (
                    <a className="mt-1 block text-xs font-medium text-brand-teal underline" href={resetLink}>
                      Open password reset link
                    </a>
                  )}
                </Alert>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-border/70 text-center">
              <p className="text-[11px] text-muted-foreground">
                Prefill demo credentials:{" "}
                <button
                  type="button"
                  className="font-medium text-brand-teal hover:underline"
                  onClick={() => {
                    setEmail("admin@demo.test");
                    setPassword("Demo1234!");
                  }}
                >
                  admin@demo.test
                </button>{" "}
                ·{" "}
                <button
                  type="button"
                  className="font-medium text-brand-teal hover:underline"
                  onClick={() => {
                    setEmail("member@demo.test");
                    setPassword("Demo1234!");
                  }}
                >
                  member@demo.test
                </button>
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
