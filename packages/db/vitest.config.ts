import { defineConfig } from "vitest/config";

/**
 * `packages/db` is schema, migrations and operator tools — almost all of it is
 * exercised by the integration tier in `packages/core`, against a real
 * Postgres. This config exists for the pieces that must hold BEFORE a
 * connection is opened, where "run it and see" is exactly the wrong test:
 * today that is `seed-guard.ts`, whose whole job is to refuse.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
