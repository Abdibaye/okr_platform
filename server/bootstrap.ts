import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { companies, user, account, companyMemberships } from "./schema";
import { demoCompanyId } from "./auth";

let bootstrapPromise: Promise<void> | null = null;

export async function ensureBootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      const database = getDb();

      // 1. Ensure Alineo Workspace exists so foreign keys to companies never fail
      await database
        .insert(companies)
        .values({
          id: demoCompanyId,
          name: "Alineo Demo Workspace",
        })
        .onConflictDoNothing();

      // 2. Check if admin@demo.test exists
      const [adminUser] = await database
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "admin@demo.test"))
        .limit(1);

      if (!adminUser) {
        const passwordHash = await hashPassword("Demo1234!");
        const adminId = crypto.randomUUID();
        const memberId = crypto.randomUUID();

        // Seed admin user
        await database
          .insert(user)
          .values({
            id: adminId,
            name: "Demo Admin",
            email: "admin@demo.test",
            emailVerified: true,
          })
          .onConflictDoNothing();

        await database
          .insert(account)
          .values({
            id: crypto.randomUUID(),
            accountId: adminId,
            providerId: "credential",
            userId: adminId,
            password: passwordHash,
          })
          .onConflictDoNothing();

        await database
          .insert(companyMemberships)
          .values({
            companyId: demoCompanyId,
            userId: adminId,
            role: "admin",
          })
          .onConflictDoNothing();

        // Seed member user
        await database
          .insert(user)
          .values({
            id: memberId,
            name: "Demo Member",
            email: "member@demo.test",
            emailVerified: true,
          })
          .onConflictDoNothing();

        await database
          .insert(account)
          .values({
            id: crypto.randomUUID(),
            accountId: memberId,
            providerId: "credential",
            userId: memberId,
            password: passwordHash,
          })
          .onConflictDoNothing();

        await database
          .insert(companyMemberships)
          .values({
            companyId: demoCompanyId,
            userId: memberId,
            role: "member",
          })
          .onConflictDoNothing();
      }
    } catch (error) {
      console.warn("Bootstrap warning:", error);
      // Allow retry if this attempt encountered a transient issue
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}
