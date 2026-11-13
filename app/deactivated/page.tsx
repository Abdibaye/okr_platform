import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRequestContext } from "@/server/request-context";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function DeactivatedPage() {
  const context = await getRequestContext().catch(() => null);
  if (!context) redirect("/");
  if (context.isActive) redirect("/dashboard");

  return (
    <main className="grid min-h-dvh place-items-center bg-auth-canvas px-4 py-8">
      <Card className="w-full max-w-md gap-6 rounded-xl border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-2xl">Your access is paused</CardTitle>
          <CardDescription>
            Your account in {context.companyName} has been deactivated by an admin, so you can no longer open this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your past check-ins and comments are kept. If you think this is a mistake, contact a workspace admin to reactivate your account.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
