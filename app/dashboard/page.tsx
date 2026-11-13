import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/request-context";
import { OkrDashboard } from "../okr-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const hasSessionCookie = cookieStore.getAll().some((cookie) => cookie.name.includes("better-auth.session_token"));
  if (!hasSessionCookie) redirect("/");

  const context = await getRequestContext().catch(() => null);
  if (!context) redirect("/?session=expired");
  if (!context.isActive) redirect("/deactivated");

  return <main className="mx-auto max-w-6xl p-6"><OkrDashboard /></main>;
}
