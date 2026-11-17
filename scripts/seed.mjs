import { Client } from "pg";
import { hashPassword } from "better-auth/crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const demoCompanyId = "6e2c4a1e-89a1-4d57-9c37-832473fd28d6";
const secondCompanyId = "d7e551b2-1d22-4833-9b9d-64a64594c8ff";
const password = "Demo1234!";

const demoUsers = [
  { email: "admin@demo.test", name: "Demo Admin", role: "admin", companyId: demoCompanyId },
  { email: "member@demo.test", name: "Demo Member", role: "member", companyId: demoCompanyId },
  { email: "outsider@demo.test", name: "Other Company Member", role: "admin", companyId: secondCompanyId },
];
const passwordHash = await hashPassword(password);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
  statement_timeout: 0,
  idle_in_transaction_session_timeout: 0,
});

await client.connect();
try {
  const companyInsert = await client.query(
    `INSERT INTO companies (id, name)
     VALUES ($1, 'Demo Company'), ($2, 'Second Company')
     ON CONFLICT (id) DO NOTHING`,
    [demoCompanyId, secondCompanyId],
  );

  for (const demoUser of demoUsers) {
    const userInsert = await client.query(
      `INSERT INTO "user" (id, name, email, email_verified)
       VALUES (gen_random_uuid(), $1, $2, true)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email`,
      [demoUser.name, demoUser.email],
    );
    const userId = userInsert.rows[0]?.id;
    const user = userId
      ? { id: userId, email: demoUser.email }
      : (await client.query(`SELECT id, email FROM "user" WHERE email = $1`, [demoUser.email])).rows[0];

    await client.query(
      `INSERT INTO company_memberships (company_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, user_id) DO NOTHING`,
      [demoUser.companyId, user.id, demoUser.role],
    );

    const existingAccount = await client.query(
      `SELECT id FROM account WHERE user_id = $1 AND provider_id = 'credential'`,
      [user.id],
    );
    if (existingAccount.rowCount === 0) {
      await client.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'credential', $1, $2, now(), now())`,
      [user.id, passwordHash],
      );
      console.log(`Created ${user.email} with password ${password}`);
    }
  }
  await client.query(
    `UPDATE account SET password = $1, updated_at = now()
     WHERE user_id IN (SELECT id FROM "user" WHERE email = ANY($2)) AND provider_id = 'credential'`,
    [passwordHash, demoUsers.map((demoUser) => demoUser.email)],
  );

  console.log(`Companies inserted: ${companyInsert.rowCount ?? 0}`);
  console.log("Seed complete: admin@demo.test / Demo1234!, member@demo.test / Demo1234!, outsider@demo.test / Demo1234!");
} finally {
  await client.end();
}
