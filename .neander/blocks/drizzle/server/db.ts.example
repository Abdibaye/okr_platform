import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
let database: NodePgDatabase<typeof schema> | undefined;
// Lazy: builds do not need credentials or a live database.
export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return database ??= drizzle(new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000 }), { schema });
}
