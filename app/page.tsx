import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/request-context";
import { AuthScreen } from "./auth-screen";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; session?: string }>;
}) {
  const cookieStore = await cookies();
  const hasSessionCookie = cookieStore.getAll().some((cookie) => cookie.name.includes("better-auth.session_token"));
  if (hasSessionCookie) {
    const context = await getRequestContext().catch(() => null);
    if (context) redirect(context.isActive ? "/dashboard" : "/deactivated");
  }

  const { reset, session } = await searchParams;
  const initialNotice =
    reset === "success"
      ? "Password updated. Sign in with your new password."
      : session === "expired"
        ? "Your session ended. Sign in again to continue."
        : null;

  return <AuthScreen initialNotice={initialNotice} />;
}
