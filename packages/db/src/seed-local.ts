import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

/**
 * `pnpm seed:local` — the one-command local seed.
 *
 * Pins BOTH database URLs to the local Supabase stack BEFORE anything else
 * reads the environment (packages/db/.env may point at hosted — that must
 * never be a seed target by accident), then loads the repo-root .env.test
 * that `pnpm test:env:up` wrote, so the staff/customer account seeding has
 * its SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY without any manual sourcing.
 */
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.DIRECT_DATABASE_URL = LOCAL_DB_URL;

loadEnv({
  path: fileURLToPath(new URL("../../../.env.test", import.meta.url)),
  quiet: true,
});

// Dynamic import so the env above is in place before seed.ts runs
// (the package is CJS, so no top-level await here).
import("./seed").catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
