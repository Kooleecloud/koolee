import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local dev convenience. In CI these come from the environment.
// Same shell-first rule as src/migrate.ts: an inline DATABASE_URL /
// DIRECT_DATABASE_URL must beat every dotenv file (packages/db/.env points at
// the cloud project).
const shellDirectUrl = process.env.DIRECT_DATABASE_URL;
const shellDatabaseUrl = process.env.DATABASE_URL;

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

/**
 * drizzle-kit talks to the **direct** connection (port 5432), never the pooler.
 *
 * DDL and the advisory lock the migrator takes both need a stable backend
 * connection; Supavisor transaction mode hands out a different one per
 * statement, which breaks both.
 *
 * `generate` works offline — no URL needed. Only `migrate`/`push`/`studio`
 * actually connect.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      shellDirectUrl ??
      shellDatabaseUrl ??
      process.env.DIRECT_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgres://localhost:5432/postgres",
  },
  strict: true,
  verbose: true,
});
