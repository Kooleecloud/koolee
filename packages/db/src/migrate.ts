import { fileURLToPath } from "node:url";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createMigrationClient } from "./client";

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

/**
 * Applies pending migrations over the DIRECT connection (port 5432).
 *
 * Never point this at the Supavisor pooler: the migrator takes an advisory
 * lock and issues DDL, both of which need a stable backend connection.
 */
async function main(): Promise<void> {
  const client = createMigrationClient();
  const db = drizzle(client);

  console.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");

  await client.end();
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
