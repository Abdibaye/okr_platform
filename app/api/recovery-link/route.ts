import { NextResponse } from "next/server";
import { getAuth, takeResetLink } from "@/server/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: string } | null;
  const email = body?.email?.trim();
  if (!email) return NextResponse.json({ error: "Enter the account email." }, { status: 400 });

  await getAuth().api.requestPasswordReset({
    body: { email, redirectTo: new URL("/reset-password", request.url).toString() },
    headers: request.headers,
  });

  const resetLink = process.env.NODE_ENV === "production" ? undefined : takeResetLink(email);
  return NextResponse.json({
    message: "If the account exists, a reset link is ready.",
    resetLink,
  });
}
