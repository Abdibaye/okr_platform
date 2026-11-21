import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "./db";
import { acceptInvitation } from "./people";
import { companies, companyMemberships, invitations } from "./schema";
import { senderAddress } from "./email";
import { buildResetPasswordEmail } from "./reset-email";

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

async function deliverResetPasswordEmail(email: string, url: string, name?: string | null) {
  const message = buildResetPasswordEmail({ email, url, name });
  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderAddress(),
        to: [email],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      const detail = (payload?.message || payload?.error) ? `: ${payload.message || payload.error}` : ` (${response.status})`;
      throw new Error(`Email delivery failed${detail}`.slice(0, 500));
    }
    return;
  }

  if (process.env.PASSWORD_RESET_WEBHOOK_URL) {
    const response = await fetch(process.env.PASSWORD_RESET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, url, subject: message.subject, text: message.text, html: message.html }),
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
    const devPorts = new Set(["3000", ...(process.env.PORT ? [process.env.PORT] : [])]);
    for (const port of devPorts) {
      for (const host of ["localhost", "127.0.0.1"]) {
        const origin = `http://${host}:${port}`;
        if (!trustedOrigins.includes(origin)) trustedOrigins.push(origin);
      }
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
        await deliverResetPasswordEmail(user.email, url, user.name);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const database = getDb();
            const joined = await database.transaction(async (transaction) => {
              const [invitation] = await transaction.select().from(invitations).where(and(
                eq(invitations.email, user.email.trim().toLowerCase()),
                eq(invitations.status, "pending"),
                gt(invitations.expiresAt, new Date()),
              )).orderBy(desc(invitations.createdAt)).limit(1).for("update");
              if (!invitation) return false;
              await acceptInvitation(transaction, invitation, user.id);
              return true;
            });
            if (joined) return;
            await database.insert(companies).values({
              id: demoCompanyId,
              name: "Alineo Demo Workspace",
            }).onConflictDoNothing();

            const [existingAdmin] = await database.select({ id: companyMemberships.id })
              .from(companyMemberships)
              .where(and(eq(companyMemberships.companyId, demoCompanyId), eq(companyMemberships.role, "admin")))
              .limit(1);

            await database.insert(companyMemberships).values({
              companyId: demoCompanyId,
              userId: user.id,
              role: existingAdmin ? "member" : "admin",
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
