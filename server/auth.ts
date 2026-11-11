import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { getDb } from "./db";
import { companyMemberships } from "./schema";

export const demoCompanyId = "6e2c4a1e-89a1-4d57-9c37-832473fd28d6";

const RESET_LINK_TTL_MS = 15 * 60 * 1000;
const resetLinks = new Map<string, { url: string; expiresAt: number }>();

function pruneExpiredResetLinks(now = Date.now()) {
  for (const [key, entry] of resetLinks.entries()) {
    if (entry.expiresAt <= now) resetLinks.delete(key);
  }
}

export function takeResetLink(email: string) {
  const now = Date.now();
  pruneExpiredResetLinks(now);
  const key = email.trim().toLowerCase();
  const entry = resetLinks.get(key);
  resetLinks.delete(key);
  return entry && entry.expiresAt > now ? entry.url : undefined;
}

export function hasResetEmailDelivery() {
  return Boolean(process.env.RESEND_API_KEY || process.env.PASSWORD_RESET_WEBHOOK_URL);
}

async function deliverResetPasswordEmail(email: string, url: string) {
  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "OKR Platform <onboarding@resend.dev>",
        to: [email],
        subject: "Reset your OKR password",
        text: `Reset your password using this link: ${url}`,
        html: `<p>Reset your OKR Platform password using the link below:</p><p><a href="${url}">Reset password</a></p>`,
      }),
    });
    if (!response.ok) {
      throw new Error(`Email delivery failed (${response.status})`);
    }
    return;
  }

  if (process.env.PASSWORD_RESET_WEBHOOK_URL) {
    const response = await fetch(process.env.PASSWORD_RESET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, url }),
    });
    if (!response.ok) {
      throw new Error(`Password reset webhook failed (${response.status})`);
    }
    return;
  }

  pruneExpiredResetLinks();
  resetLinks.set(email.toLowerCase(), { url, expiresAt: Date.now() + RESET_LINK_TTL_MS });
  if (process.env.NODE_ENV !== "production") {
    console.info(`Password reset link for ${email}: ${url}`);
  } else {
    console.warn(`Password reset requested for ${email}, but no email transport is configured.`);
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createAuth() {
  const isProduction = process.env.NODE_ENV === "production";
  const baseURL = process.env.BETTER_AUTH_URL || (isProduction ? required("BETTER_AUTH_URL") : "http://127.0.0.1:3000");
  const trustedOrigins = [new URL(baseURL).origin];
  if (!isProduction) {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      if (!trustedOrigins.includes(origin)) trustedOrigins.push(origin);
    }
  }

  return betterAuth({
    baseURL,
    trustedOrigins,
    secret: required("BETTER_AUTH_SECRET"),
    database: drizzleAdapter(getDb(), { provider: "pg" }),
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliverResetPasswordEmail(user.email, url);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getDb().insert(companyMemberships).values({
              companyId: demoCompanyId,
              userId: user.id,
              role: "member",
            }).onConflictDoNothing();
          },
        },
      },
    },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return auth ??= createAuth();
}
