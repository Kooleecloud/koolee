import { fileURLToPath } from "node:url";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createMigrationClient } from "./client";

// Capture what the shell provided BEFORE dotenv fills the gaps. dotenv never
// overrides variables that are already set, but it cannot help with the
// cross-variable case: an inline `DATABASE_URL=... pnpm db:migrate` used to be
// silently ignored because only DIRECT_DATABASE_URL was consulted — and
// packages/db/.env points that at the cloud project. Shell always wins here.
const shellDirectUrl = process.env.DIRECT_DATABASE_URL;
const shellDatabaseUrl = process.env.DATABASE_URL;

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

const connectionString =
  shellDirectUrl ??
  shellDatabaseUrl ??
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL;

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
  const client = createMigrationClient(connectionString);
  const db = drizzle(client);

  // Host only — never the credentials. Migrations silently landing on the
  // wrong database is exactly the failure this line exists to make visible.
  console.log(`Target host: ${new URL(connectionString!).hostname}`);
  console.log(`Applying migrations from ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied.");
  } finally {
    // A failed migration must exit non-zero, not hang on the open connection.
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
