import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// `scripts/test-env.sh up` writes .env.test at the repo root with
// TEST_DATABASE_URL / AUTH_SCHEMA_AVAILABLE pointed at local Supabase.
// dotenv never overrides variables already exported in the shell, so an
// explicit `TEST_DATABASE_URL=... pnpm test:integration` still wins, and a
// missing .env.test is silently fine (integration tests then skip as before).
loadEnv({ path: fileURLToPath(new URL("../../.env.test", import.meta.url)), quiet: true });

/**
 * One config, two kinds of test.
 *
 * `*.test.ts` are pure and always run. `*.integration.test.ts` need a real
 * Postgres and skip themselves unless `TEST_DATABASE_URL` is set — that is what
 * keeps `pnpm test` green on a fresh clone with no environment configured.
 *
 * `pnpm test:integration` narrows the run to the integration files by name.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests migrate a database and share rows.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
