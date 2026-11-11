import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { companyMemberships } from "./schema";

export const demoCompanyId = "6e2c4a1e-89a1-4d57-9c37-832473fd28d6";

const resetLinks = new Map<string, string>();

export function takeResetLink(email: string) {
  const key = email.trim().toLowerCase();
  const link = resetLinks.get(key);
  resetLinks.delete(key);
  return link;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createAuth() {
  const isProduction = process.env.NODE_ENV === "production";
  const baseURL = process.env.BETTER_AUTH_URL || (isProduction ? required("BETTER_AUTH_URL") : "http://127.0.0.1:3000");
  const trustedOrigins = [baseURL];
  if (!isProduction) trustedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000");

  return betterAuth({
    baseURL,
    trustedOrigins,
    secret: required("BETTER_AUTH_SECRET"),
    database: drizzleAdapter(getDb(), { provider: "pg" }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        resetLinks.set(user.email.toLowerCase(), url);
        if (!isProduction) console.info(`Password reset link for ${user.email}: ${url}`);
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
