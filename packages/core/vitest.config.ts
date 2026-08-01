import { defineConfig } from "vitest/config";

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
