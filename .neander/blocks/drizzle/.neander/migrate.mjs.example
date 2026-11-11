import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
await client.connect();
try {
  const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('neander_schema_migrations')) AS locked");
  if (!lock.rows[0].locked) throw new Error("Another schema migration is running");
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
} finally { await client.end(); } // Closing the connection releases the session lock.
