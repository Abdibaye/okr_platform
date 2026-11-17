import { NextResponse } from "next/server";
import { getAuth, hasResetEmailDelivery, takeResetLink } from "@/server/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: string } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid account email." }, { status: 400 });
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !hasResetEmailDelivery()) {
    return NextResponse.json(
      { error: "Password reset email delivery is not configured for production (set RESEND_API_KEY or PASSWORD_RESET_WEBHOOK_URL)." },
      { status: 503 },
    );
  }

  const redirectOrigin = process.env.BETTER_AUTH_URL || request.url;
  try {
    await getAuth().api.requestPasswordReset({
      body: { email, redirectTo: new URL("/reset-password", redirectOrigin).toString() },
      headers: request.headers,
    });
  } catch {
    return NextResponse.json({ error: "Could not deliver password reset email." }, { status: 502 });
  }

  const resetLink = isProduction ? undefined : takeResetLink(email);
  return NextResponse.json({
    message: isProduction
      ? "If an account matches that email, a password reset email has been sent."
      : "If the account exists, a reset link is ready.",
    resetLink,
  });
}
