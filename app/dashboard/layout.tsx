import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/request-context";
import { DashboardShell } from "@/components/okr/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const hasSessionCookie = cookieStore.getAll().some((cookie) => cookie.name.includes("better-auth.session_token"));
  if (!hasSessionCookie) redirect("/");

  const context = await getRequestContext().catch(() => null);
  if (!context) redirect("/?session=expired");
  if (!context.isActive) redirect("/deactivated");

  return <DashboardShell>{children}</DashboardShell>;
}
