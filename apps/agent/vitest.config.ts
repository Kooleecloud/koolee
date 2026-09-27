import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Node environment, colocated `*.test.ts`. Two aliases, both borrowed from
 * apps/web: `@` so tests can import route modules the way the app does, and
 * `server-only` stubbed out — the real package throws outside an RSC bundle,
 * and the API route wrapper sits behind modules that import it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": src,
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
